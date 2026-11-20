//! Models, downloaded on request from their pinned Hugging Face revisions
//! into the app's data folder instead of shipping in the app.
//!
//! Each file downloads as `<name>.part`, resumes from where a dropped
//! connection left it, and takes its own name only once its SHA-256 matches,
//! so a model whose files all exist is complete.

use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::error::{Error, Result};

/// Progress is reported each time this much more has arrived.
const PROGRESS_STEP: u64 = 1 << 20;
const CHUNK: usize = 1 << 16;

/// The models the app can download.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Model {
    /// What live subtitles need: SenseVoice-Small to transcribe, FireRedVAD to
    /// find speech and tell talk from singing and music. See `speech`.
    Subtitles,
    /// opus-mt-zh-en, which translates chat messages into English. See `translation`.
    Translator,
}

pub struct ModelFile {
    /// Its name in the model's folder, as the model's loader reads it.
    pub name: &'static str,
    /// The folder it downloads from.
    url: &'static str,
    /// Its name in that folder, when not `name`.
    remote: Option<&'static str>,
    bytes: u64,
    sha256: &'static str,
}

const SENSEVOICE: &str = "https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/2365baeacb507f821a0c8120fcee3d484dba7a07";
const FIRERED_VAD: &str = "https://huggingface.co/FireRedTeam/FireRedVAD/resolve/7990aaccc6b7aec1e527743bd30201f2c4a03b8c/Stream-VAD";
const FIRERED_AED: &str = "https://huggingface.co/FireRedTeam/FireRedVAD/resolve/7990aaccc6b7aec1e527743bd30201f2c4a03b8c/AED";
const OPUS_MT: &str =
    "https://huggingface.co/Xenova/opus-mt-zh-en/resolve/39d480d52a9ea3065a1f117adfe4dbc55de10e6f";
const OPUS_MT_GRAPHS: &str = "https://huggingface.co/Xenova/opus-mt-zh-en/resolve/39d480d52a9ea3065a1f117adfe4dbc55de10e6f/onnx";

const SUBTITLES: [ModelFile; 5] = [
    ModelFile {
        name: "model.onnx",
        url: SENSEVOICE,
        remote: None,
        bytes: 937_617_178,
        sha256: "977016bd9c79f9eb343430b5cc305e07ab64d5212dff41b0dcfa1694bee9a8cb",
    },
    ModelFile {
        name: "tokens.txt",
        url: SENSEVOICE,
        remote: None,
        bytes: 315_894,
        sha256: "f449eb28dc567533d7fa59be34e2abca8784f771850c78a47fb731a31429a1dc",
    },
    ModelFile {
        name: "model.pth.tar",
        url: FIRERED_VAD,
        remote: None,
        bytes: 2_283_513,
        sha256: "ec88a8ae8ac5f004cdbd20c1eac4a9e9d12067c3d51ac5b141afa1f921fb59c9",
    },
    ModelFile {
        name: "cmvn.ark",
        url: FIRERED_VAD,
        remote: None,
        bytes: 1_311,
        sha256: "c87f6f13edf0f0ec7535ddfc9cc3387d9268cb234b70182d566c5e2edf3ca473",
    },
    ModelFile {
        name: "aed.pth.tar",
        url: FIRERED_AED,
        remote: Some("model.pth.tar"),
        bytes: 2_370_097,
        sha256: "ad08a4e05b58ca328154e158d24cff57a2fe796ceabb63bb701544c3f7d4f7ad",
    },
];

const TRANSLATOR: [ModelFile; 5] = [
    ModelFile {
        name: "source.spm",
        url: OPUS_MT,
        remote: None,
        bytes: 804_677,
        sha256: "e27a3a1b539f4959ec72ea60e453f49156289f95d4e6000b29332efc45616203",
    },
    ModelFile {
        name: "vocab.json",
        url: OPUS_MT,
        remote: None,
        bytes: 1_747_906,
        sha256: "08a119a1defd522fa047cb5e3bfe3e89633e96caa38ced0dc9cee7ef1021a011",
    },
    ModelFile {
        name: "encoder_model_fp16.onnx",
        url: OPUS_MT_GRAPHS,
        remote: None,
        bytes: 105_062_004,
        sha256: "82feb1ecc135aad5b07e1aa4fae41479c28e7336af4c8972e015cfe79285e279",
    },
    ModelFile {
        name: "decoder_model_fp16.onnx",
        url: OPUS_MT_GRAPHS,
        remote: None,
        bytes: 117_926_564,
        sha256: "6c049261c523d4e89002656b99bf0a5988eda3d3d6b74730d022e843c0c03f41",
    },
    ModelFile {
        name: "decoder_with_past_model_fp16.onnx",
        url: OPUS_MT_GRAPHS,
        remote: None,
        bytes: 111_560_936,
        sha256: "45939416c53cff3c15baca92409d03774633ca0bade7d5f3e2093027efa81b36",
    },
];

impl Model {
    pub const ALL: [Model; 2] = [Model::Subtitles, Model::Translator];

    pub fn files(self) -> &'static [ModelFile] {
        match self {
            Model::Subtitles => &SUBTITLES,
            Model::Translator => &TRANSLATOR,
        }
    }

    /// Names the revision, so a newer one downloads beside the old, which `tidy` drops.
    fn folder(self) -> &'static str {
        match self {
            Model::Subtitles => "subtitles-sensevoice-fp32-2365bae",
            Model::Translator => "opus-mt-zh-en-fp16-39d480d5",
        }
    }

    pub fn bytes(self) -> u64 {
        self.files().iter().map(|file| file.bytes).sum()
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelStatus {
    pub model: Model,
    /// The whole download's size.
    pub bytes: u64,
    pub downloaded: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    /// Bytes on disk so far, counting what an earlier attempt left.
    pub downloaded: u64,
    pub total: u64,
}

pub struct Models {
    root: PathBuf,
}

impl Models {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }

    /// Where `model`'s files are, once `is_downloaded`.
    pub fn dir(&self, model: Model) -> PathBuf {
        self.root.join(model.folder())
    }

    pub fn is_downloaded(&self, model: Model) -> bool {
        let dir = self.dir(model);
        model.files().iter().all(|file| {
            fs::metadata(dir.join(file.name)).is_ok_and(|metadata| metadata.len() == file.bytes)
        })
    }

    pub fn statuses(&self) -> Vec<ModelStatus> {
        Model::ALL
            .into_iter()
            .map(|model| ModelStatus {
                model,
                bytes: model.bytes(),
                downloaded: self.is_downloaded(model),
            })
            .collect()
    }

    /// Downloads whatever `model` still lacks. Returns false when `cancelled`
    /// stopped it; what arrived so far stays for the next attempt.
    pub fn download(
        &self,
        model: Model,
        cancelled: &AtomicBool,
        mut progress: impl FnMut(DownloadProgress),
    ) -> Result<bool> {
        let dir = self.dir(model);
        fs::create_dir_all(&dir)?;
        let agent: ureq::Agent = ureq::Agent::config_builder()
            .timeout_connect(Some(Duration::from_secs(20)))
            .timeout_recv_response(Some(Duration::from_secs(30)))
            .build()
            .into();
        let total = model.bytes();
        let mut done: u64 = model
            .files()
            .iter()
            .map(|file| on_disk(&dir, file).min(file.bytes))
            .sum();
        progress(DownloadProgress {
            downloaded: done,
            total,
        });
        let mut reported = done;
        for file in model.files() {
            let target = dir.join(file.name);
            if target.is_file() {
                continue;
            }
            let part = part_path(&dir, file);
            let others = done - on_disk(&dir, file).min(file.bytes);
            let finished = fetch(&agent, file, &part, cancelled, |now| {
                done = others + now.min(file.bytes);
                if done.abs_diff(reported) >= PROGRESS_STEP {
                    reported = done;
                    progress(DownloadProgress {
                        downloaded: done,
                        total,
                    });
                }
            })?;
            if !finished {
                return Ok(false);
            }
            if sha256(&part)? != file.sha256 {
                fs::remove_file(&part)?;
                return Err(Error::Download(format!(
                    "{} arrived damaged; try again",
                    file.name
                )));
            }
            fs::rename(&part, &target)?;
        }
        progress(DownloadProgress {
            downloaded: total,
            total,
        });
        Ok(true)
    }

    pub fn delete(&self, model: Model) -> Result<()> {
        match fs::remove_dir_all(self.dir(model)) {
            Err(error) if error.kind() != io::ErrorKind::NotFound => Err(error.into()),
            _ => Ok(()),
        }
    }

    /// Drops the folders of revisions no longer used.
    pub fn tidy(&self) -> Result<()> {
        let Ok(entries) = fs::read_dir(&self.root) else {
            return Ok(());
        };
        for entry in entries {
            let entry = entry?;
            let current = Model::ALL
                .iter()
                .any(|model| entry.file_name() == model.folder());
            if !current {
                fs::remove_dir_all(entry.path())?;
            }
        }
        Ok(())
    }
}

fn part_path(dir: &Path, file: &ModelFile) -> PathBuf {
    dir.join(format!("{}.part", file.name))
}

/// Bytes of `file` on disk, finished or not.
fn on_disk(dir: &Path, file: &ModelFile) -> u64 {
    if dir.join(file.name).is_file() {
        return file.bytes;
    }
    fs::metadata(part_path(dir, file)).map_or(0, |metadata| metadata.len())
}

/// Appends the rest of `file` to `part`, reporting its length as it grows.
/// Returns false when cancelled.
fn fetch(
    agent: &ureq::Agent,
    file: &ModelFile,
    part: &Path,
    cancelled: &AtomicBool,
    mut grown: impl FnMut(u64),
) -> Result<bool> {
    let mut have = fs::metadata(part).map_or(0, |metadata| metadata.len());
    if have > file.bytes {
        fs::remove_file(part)?;
        have = 0;
    }
    if have == file.bytes {
        return Ok(true);
    }
    let url = format!("{}/{}", file.url, file.remote.unwrap_or(file.name));
    let mut response = agent
        .get(&url)
        .header("Range", format!("bytes={have}-"))
        .call()
        .map_err(|error| Error::Download(error.to_string()))?;
    // A server that ignores the range sends the whole file again.
    let resumed = response.status() == 206;
    let mut out = if resumed {
        OpenOptions::new().create(true).append(true).open(part)?
    } else {
        have = 0;
        File::create(part)?
    };
    let mut body = response.body_mut().as_reader();
    let mut buffer = vec![0; CHUNK];
    loop {
        if cancelled.load(Ordering::Relaxed) {
            return Ok(false);
        }
        let read = body
            .read(&mut buffer)
            .map_err(|error| Error::Download(error.to_string()))?;
        if read == 0 {
            break;
        }
        out.write_all(&buffer[..read])?;
        have += read as u64;
        grown(have);
    }
    out.flush()?;
    if have != file.bytes {
        return Err(Error::Download(format!(
            "{} stopped after {have} of {} bytes",
            file.name, file.bytes
        )));
    }
    Ok(true)
}

fn sha256(path: &Path) -> Result<String> {
    let mut hasher = Sha256::new();
    io::copy(&mut File::open(path)?, &mut hasher)?;
    Ok(format!("{:x}", hasher.finalize()))
}

/// The real models, downloaded once into `target/models` for the tests that need them.
#[cfg(test)]
pub(crate) fn downloaded(model: Model) -> PathBuf {
    let models = Models::new(Path::new(env!("CARGO_MANIFEST_DIR")).join("../target/models"));
    if !models.is_downloaded(model) {
        assert!(
            models
                .download(model, &AtomicBool::new(false), |_| {})
                .unwrap()
        );
    }
    models.dir(model)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_what_the_translator_reads() {
        let mut names: Vec<&str> = TRANSLATOR.iter().map(|file| file.name).collect();
        names.sort_unstable();
        let mut read = crate::translation::FILES.to_vec();
        read.sort_unstable();
        assert_eq!(names, read);
    }

    #[test]
    fn serializes_the_model_with_the_frontend_name() {
        assert_eq!(
            serde_json::to_value(Model::Translator).unwrap(),
            serde_json::json!("translator")
        );
    }

    #[test]
    fn drops_folders_of_models_no_longer_used() {
        let root = tempfile::tempdir().unwrap();
        let models = Models::new(root.path().to_owned());
        fs::create_dir_all(root.path().join("moss-tts-nano-fp16-f5f2cf42")).unwrap();

        models.tidy().unwrap();

        assert!(!root.path().join("moss-tts-nano-fp16-f5f2cf42").exists());
    }

    #[test]
    fn serializes_progress_with_the_frontend_field_names() {
        let progress = serde_json::to_value(DownloadProgress {
            downloaded: 1,
            total: 2,
        })
        .unwrap();
        assert_eq!(progress, serde_json::json!({ "downloaded": 1, "total": 2 }));
    }
}
