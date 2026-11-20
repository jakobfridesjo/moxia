//! FireRedVAD's network, shared by its voice activity detector and its audio
//! event detector: a DFSMN (feedforward layers whose memory reaches over the
//! 20 frames before each one, and in the event detector the 20 after too),
//! read from the official checkpoint.

use std::fs::File;
use std::io::BufReader;
use std::path::Path;

use anyhow::{Context, Result, bail, ensure};
use tract_onnx::prelude::tract_ndarray::{Array1, Array2};

use super::fbank::{Frame, MELS};
use super::torch::{self, Tensor};

/// Each layer's memory: this many frames, the current one included.
pub const MEMORY: usize = 20;
/// How many frames after the current one each layer of the event detector looks at.
pub const LOOKAHEAD: usize = 20;
/// DFSMN blocks after the first.
pub const BLOCKS: usize = 7;

pub struct Linear {
    /// Transposed: inputs by outputs.
    weight: Array2<f32>,
    bias: Option<Array1<f32>>,
}

impl Linear {
    pub fn apply(&self, x: &Array2<f32>, relu: bool) -> Array2<f32> {
        let mut y = x.dot(&self.weight);
        if let Some(bias) = &self.bias {
            y += bias;
        }
        if relu {
            y.mapv_inplace(|v| v.max(0.0));
        }
        y
    }
}

/// A block: up to the hidden size, down to the projection, then the memory.
pub struct Block {
    up: Linear,
    down: Linear,
    /// The first block's projection goes through a ReLU; the others' do not.
    first: bool,
    /// Frames by channels, oldest first.
    pub back: Array2<f32>,
    /// Frames by channels, the next frame first, when the block looks ahead.
    pub ahead: Option<Array2<f32>>,
}

impl Block {
    pub fn project(&self, x: &Array2<f32>) -> Array2<f32> {
        self.down.apply(&self.up.apply(x, true), self.first)
    }
}

pub struct Dfsmn {
    means: Array1<f32>,
    inverse_deviations: Array1<f32>,
    pub first: Block,
    pub blocks: Vec<Block>,
    dnn: Linear,
    out: Linear,
}

impl Dfsmn {
    /// Reads the network from `checkpoint` and the statistics its input is
    /// normalized with from `statistics`; `looks_ahead` for the event detector.
    pub fn load(checkpoint: &Path, statistics: &Path, looks_ahead: bool) -> Result<Self> {
        let mut tensors = torch::state_dict(BufReader::new(File::open(checkpoint)?))?;
        let mut take = |name: &str| {
            tensors
                .remove(name)
                .with_context(|| format!("{name} is missing"))
        };
        let memory_names = std::iter::once("dfsmn.fsmn1".to_owned())
            .chain((0..BLOCKS).map(|i| format!("dfsmn.fsmns.{i}.fsmn")))
            .collect::<Vec<_>>();
        let mut memories = Vec::new();
        for name in &memory_names {
            let back = memory(take(&format!("{name}.lookback_filter.weight"))?)?;
            let ahead = looks_ahead
                .then(|| take(&format!("{name}.lookahead_filter.weight")).and_then(memory))
                .transpose()?;
            memories.push((back, ahead));
        }
        let mut memories = memories.into_iter();
        let mut linear = |weight: &str, bias: Option<&str>| -> Result<Linear> {
            Ok(Linear {
                weight: matrix(take(weight)?)?.reversed_axes(),
                bias: bias
                    .map(|name| take(name).map(|t| Array1::from(t.data)))
                    .transpose()?,
            })
        };
        let mut block = |up: Linear, down: Linear, first: bool| -> Result<Block> {
            let (back, ahead) = memories.next().context("a memory is missing")?;
            Ok(Block {
                up,
                down,
                first,
                back,
                ahead,
            })
        };
        let first = block(
            linear("dfsmn.fc1.0.weight", Some("dfsmn.fc1.0.bias"))?,
            linear("dfsmn.fc2.0.weight", Some("dfsmn.fc2.0.bias"))?,
            true,
        )?;
        let mut blocks = Vec::with_capacity(BLOCKS);
        for i in 0..BLOCKS {
            let name = |part: &str| format!("dfsmn.fsmns.{i}.{part}");
            blocks.push(block(
                linear(&name("fc1.0.weight"), Some(&name("fc1.0.bias")))?,
                linear(&name("fc2.weight"), None)?,
                false,
            )?);
        }
        let dnn = linear("dfsmn.dnns.0.weight", Some("dfsmn.dnns.0.bias"))?;
        let out = linear("out.weight", Some("out.bias"))?;
        ensure!(
            tensors.is_empty(),
            "the checkpoint is not the detector expected: {:?} are left over",
            tensors.keys().collect::<Vec<_>>()
        );
        let (means, inverse_deviations) = cmvn(&std::fs::read(statistics)?)?;
        Ok(Self {
            means,
            inverse_deviations,
            first,
            blocks,
            dnn,
            out,
        })
    }

    /// Projection channels, which each memory works over.
    pub fn channels(&self) -> usize {
        self.first.back.ncols()
    }

    /// `frames` normalized as the network takes them, frames by bins.
    pub fn normalized(&self, frames: &[Frame]) -> Array2<f32> {
        let mut x = Array2::from_shape_fn((frames.len(), MELS), |(t, bin)| frames[t][bin]);
        x -= &self.means;
        x *= &self.inverse_deviations;
        x
    }

    /// The probability of each output, frames by outputs, from the last block's memory.
    pub fn probabilities(&self, memory: &Array2<f32>) -> Array2<f32> {
        let mut logits = self.out.apply(&self.dnn.apply(memory, true), false);
        logits.mapv_inplace(|v| 1.0 / (1.0 + (-v).exp()));
        logits
    }
}

fn matrix(tensor: Tensor) -> Result<Array2<f32>> {
    let [rows, columns] = tensor.shape[..] else {
        bail!("not a matrix");
    };
    Ok(Array2::from_shape_vec((rows, columns), tensor.data)?)
}

/// A depthwise filter `[channels, 1, MEMORY]` as `[MEMORY, channels]`.
fn memory(tensor: Tensor) -> Result<Array2<f32>> {
    let [channels, 1, MEMORY] = tensor.shape[..] else {
        bail!("not a memory of {MEMORY} frames");
    };
    Ok(Array2::from_shape_vec((channels, MEMORY), tensor.data)?.reversed_axes())
}

/// Means and inverse standard deviations from Kaldi's binary statistics matrix.
fn cmvn(bytes: &[u8]) -> Result<(Array1<f32>, Array1<f32>)> {
    let header = bytes
        .get(..15)
        .context("the CMVN statistics are cut short")?;
    ensure!(
        &header[..2] == b"\0B",
        "the CMVN statistics are not Kaldi binary"
    );
    let size = match &header[2..5] {
        b"DM " => 8,
        b"FM " => 4,
        _ => bail!("the CMVN statistics are not a matrix"),
    };
    let int =
        |at: usize| i32::from_le_bytes([bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]]);
    let (rows, columns) = (int(6), int(11));
    ensure!(
        rows == 2 && columns == MELS as i32 + 1,
        "unexpected CMVN statistics"
    );
    let value = |row: usize, column: usize| -> Result<f64> {
        let at = 15 + (row * (MELS + 1) + column) * size;
        let raw = bytes
            .get(at..at + size)
            .context("the CMVN statistics are cut short")?;
        Ok(match size {
            8 => f64::from_le_bytes(raw.try_into()?),
            _ => f64::from(f32::from_le_bytes(raw.try_into()?)),
        })
    };
    let count = value(0, MELS)?;
    ensure!(count >= 1.0, "empty CMVN statistics");
    let mut means = Array1::zeros(MELS);
    let mut inverse = Array1::zeros(MELS);
    for bin in 0..MELS {
        let mean = value(0, bin)? / count;
        let variance = (value(1, bin)? / count - mean * mean).max(1e-20);
        means[bin] = mean as f32;
        inverse[bin] = (1.0 / variance.sqrt()) as f32;
    }
    Ok((means, inverse))
}

#[cfg(test)]
pub mod tests {
    use super::*;

    /// A small network of made-up weights, `channels` wide, for checking how
    /// frames flow through it.
    pub fn made_up(channels: usize, outputs: usize, looks_ahead: bool) -> Dfsmn {
        let mut seed = 7u32;
        let mut array = |rows: usize, columns: usize, scale: f32| {
            Array2::from_shape_fn((rows, columns), |_| {
                seed = seed.wrapping_mul(1_103_515_245).wrapping_add(12345);
                (f32::from((seed >> 16) as u16) / 65_536.0 - 0.5) * scale
            })
        };
        let hidden = channels * 2;
        let mut linear = |inputs: usize, outputs: usize, bias: bool| Linear {
            weight: array(inputs, outputs, 0.6),
            bias: bias.then(|| Array1::from_elem(outputs, 0.05)),
        };
        let mut block = |inputs: usize, first: bool| Block {
            up: linear(inputs, hidden, true),
            down: linear(hidden, channels, first),
            first,
            back: linear(MEMORY, channels, false).weight * (0.2 / 0.6),
            ahead: looks_ahead.then(|| linear(LOOKAHEAD, channels, false).weight * (0.2 / 0.6)),
        };
        let first = block(MELS, true);
        let blocks = (0..BLOCKS).map(|_| block(channels, false)).collect();
        let dnn = linear(channels, hidden, true);
        let out = linear(hidden, outputs, true);
        Dfsmn {
            means: Array1::zeros(MELS),
            inverse_deviations: Array1::ones(MELS),
            first,
            blocks,
            dnn,
            out,
        }
    }

    #[test]
    fn reads_kaldi_binary_statistics() {
        let mut bytes = b"\0BDM \x04".to_vec();
        bytes.extend(2i32.to_le_bytes());
        bytes.push(4);
        bytes.extend(81i32.to_le_bytes());
        let sums = (0..80).map(|_| 20.0).chain([10.0]);
        let squares = (0..80).map(|_| 50.0).chain([0.0]);
        for value in sums.chain(squares) {
            bytes.extend(f64::to_le_bytes(value));
        }
        let (means, inverse) = cmvn(&bytes).unwrap();
        assert_eq!(means[0], 2.0);
        assert_eq!(inverse[79], 1.0);
    }
}
