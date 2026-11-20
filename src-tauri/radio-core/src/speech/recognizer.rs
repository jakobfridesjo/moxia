//! SenseVoice-Small, as k2-fsa exports it to ONNX: filterbanks stacked seven
//! at a time every six frames (60 ms), normalized with the statistics the
//! export carries, and four tags (language, emotion, event, normalization)
//! ahead of CTC output, one token per 60 ms.

use std::collections::HashMap;
use std::path::Path;

use anyhow::{Context, Result};
use serde::Serialize;
use tract_onnx::pb::attribute_proto::AttributeType;
use tract_onnx::pb::tensor_proto::DataType;
use tract_onnx::pb::{AttributeProto, GraphProto, NodeProto, TensorProto};
use tract_onnx::prelude::*;

use super::fbank::{Fbank, Frame, MELS, RATE, SHIFT, Window};
use crate::onnx::{self, Floats, Graph};

/// Where the model as built from `model.onnx` is kept. Change the name
/// whenever `build` changes, so a copy built the old way is not used.
const BUILT: &str = "model.f16.v1.nnef.tar";
const NEGATIVE_MEANS: &str = "neg_mean";
const INVERSE_DEVIATIONS: &str = "inv_stddev";

const STACK: usize = 7;
const STRIDE: usize = 6;
const FEATURES: usize = STACK * MELS;
/// Seconds of audio between one output and the next.
const OUTPUT_SECONDS: f64 = (STRIDE * SHIFT) as f64 / RATE as f64;
/// Tags ahead of the text.
const TAGS: usize = 4;
const BLANK: usize = 0;
/// The language input that leaves the model to tell.
const AUTO_LANGUAGE: i32 = 0;
/// The normalization input that asks for punctuation and numbers as digits.
const WITH_ITN: i32 = 14;
/// How sure the model must be of the language for its words to be taken as
/// speech: what it is unsure of is mostly a noise or a breath misheard, such
/// as "Yeah." or "あ。", while speech in any language it knows is near 1.
const MIN_LANGUAGE_SURE: f32 = 0.8;
/// The emotion tags, and what each says; the model is free to say it cannot tell.
const EMOTIONS: [(&str, Option<Emotion>); 9] = [
    ("<|NEUTRAL|>", Some(Emotion::Neutral)),
    ("<|HAPPY|>", Some(Emotion::Happy)),
    ("<|SAD|>", Some(Emotion::Sad)),
    ("<|ANGRY|>", Some(Emotion::Angry)),
    ("<|FEARFUL|>", Some(Emotion::Fearful)),
    ("<|SURPRISED|>", Some(Emotion::Surprised)),
    ("<|DISGUSTED|>", Some(Emotion::Disgusted)),
    ("<|OTHER|>", None),
    ("<|EMO_UNKNOWN|>", None),
];
/// The output that carries the emotion tag.
const EMOTION_OUTPUT: usize = 1;

pub struct Recognizer {
    graph: Graph,
    fbank: Fbank,
    negative_means: Vec<f32>,
    inverse_deviations: Vec<f32>,
    tokens: Vec<String>,
    /// The emotion tags' token ids, beside what each says.
    emotions: Vec<(usize, Option<Emotion>)>,
}

/// How a voice sounds, as SenseVoice tags it.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Emotion {
    #[default]
    Neutral,
    Happy,
    Sad,
    Angry,
    Fearful,
    Surprised,
    Disgusted,
}

/// A sound other than words that SenseVoice tags in speech.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Burst {
    Laughter,
    Applause,
    Cry,
    /// A cough or a sneeze.
    Cough,
}

impl Burst {
    /// The burst SenseVoice's event tag names, if it names one.
    pub fn of(event: &str) -> Option<Self> {
        match event {
            "Laughter" => Some(Self::Laughter),
            "Applause" => Some(Self::Applause),
            "Cry" => Some(Self::Cry),
            "Cough" | "Sneeze" => Some(Self::Cough),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Transcript {
    /// Such as `zh`, `yue` or `en`; empty when the model heard no speech.
    pub language: String,
    /// Such as `Speech` or `BGM` (speech over music).
    pub event: String,
    pub text: String,
    /// When each character of `text` is said, in seconds into the samples.
    pub said: Vec<f64>,
    /// How sure the model is of `language`, from 0 to 1.
    pub language_sure: f32,
    pub emotion: Emotion,
    /// How sure the model is of `emotion`, from 0 to 1; 0 when it could not tell.
    pub emotion_sure: f32,
}

impl Transcript {
    /// Whether words were said, rather than a noise misheard.
    pub fn is_speech(&self) -> bool {
        self.language_sure >= MIN_LANGUAGE_SURE && self.text.chars().any(char::is_alphanumeric)
    }
}

impl Recognizer {
    /// Reads `model.onnx` and `tokens.txt` from `dir`, keeping the model built
    /// from `model.onnx` beside it.
    pub fn load(dir: &Path) -> Result<Self> {
        let name = "model.onnx";
        let model = onnx::cached(&dir.join(BUILT), || build(dir, name))?;
        let numbers = |key: &str| -> Result<Vec<f32>> {
            let text = model
                .properties
                .get(key)
                .with_context(|| format!("the model has no {key}"))?
                .to_plain_array_view::<String>()?;
            let values = text
                .first()
                .with_context(|| format!("{key} is empty"))?
                .split(',')
                .map(str::parse)
                .collect::<Result<Vec<f32>, _>>()?;
            anyhow::ensure!(
                values.len() == FEATURES,
                "{key} has {} values",
                values.len()
            );
            Ok(values)
        };
        let negative_means = numbers(NEGATIVE_MEANS)?;
        let inverse_deviations = numbers(INVERSE_DEVIATIONS)?;
        let tokens = std::fs::read_to_string(dir.join("tokens.txt"))?
            .lines()
            .map(|line| {
                line.rsplit_once(' ')
                    .map_or(line, |(token, _)| token)
                    .to_owned()
            })
            .collect::<Vec<String>>();
        let emotions = EMOTIONS
            .iter()
            .map(|&(tag, emotion)| {
                tokens
                    .iter()
                    .position(|token| token == tag)
                    .map(|id| (id, emotion))
                    .with_context(|| format!("the model has no {tag}"))
            })
            .collect::<Result<_>>()?;
        Ok(Self {
            graph: onnx::runnable(model, name)?,
            fbank: Fbank::new(Window::Hamming),
            negative_means,
            inverse_deviations,
            tokens,
            emotions,
        })
    }

    /// What is said in `samples`: 16 kHz, scaled as 16-bit integers.
    pub fn transcribe(&self, samples: &[f32]) -> Result<Transcript> {
        let frames = self.fbank.frames(samples);
        if frames.is_empty() {
            return Ok(Transcript {
                language: String::new(),
                event: String::new(),
                text: String::new(),
                said: Vec::new(),
                language_sure: 0.0,
                emotion: Emotion::Neutral,
                emotion_sure: 0.0,
            });
        }
        let features = stack(&frames, &self.negative_means, &self.inverse_deviations);
        let length = features.len() / FEATURES;
        let length_i32 = i32::try_from(length)?;
        let features = Tensor::from_shape(&[1, length, FEATURES], &features)?;
        let outputs = self.graph.run(tvec![
            features.cast_to::<f16>()?.into_owned().into(),
            tensor1(&[length_i32]).into(),
            tensor1(&[AUTO_LANGUAGE]).into(),
            tensor1(&[WITH_ITN]).into(),
        ])?;
        let logits = outputs[0].cast_to::<f32>()?;
        let logits = logits.to_plain_array_view::<f32>()?;
        let best: Vec<usize> = logits
            .index_axis(tract_ndarray::Axis(0), 0)
            .outer_iter()
            .map(|row| {
                row.iter()
                    .enumerate()
                    .max_by(|a, b| a.1.total_cmp(b.1))
                    .map_or(BLANK, |(id, _)| id)
            })
            .collect();
        let language = logits.slice(tract_ndarray::s![0, 0, ..]);
        let top = language.iter().copied().fold(f32::MIN, f32::max);
        let sure = 1.0
            / language
                .iter()
                .map(|logit| (logit - top).exp())
                .sum::<f32>();
        let (emotion, emotion_sure) = feeling(
            logits
                .slice(tract_ndarray::s![0, EMOTION_OUTPUT, ..])
                .as_slice()
                .unwrap_or_default(),
            &self.emotions,
        );
        Ok(Transcript {
            emotion,
            emotion_sure,
            ..decode(&best, &self.tokens, sure)
        })
    }
}

/// The emotion the tag's `logits` make likeliest, and how likely, counting
/// only the emotion tags; neutral and 0 when the likeliest says it cannot tell.
fn feeling(logits: &[f32], emotions: &[(usize, Option<Emotion>)]) -> (Emotion, f32) {
    let logit = |id: usize| logits.get(id).copied().unwrap_or(f32::MIN);
    let top = emotions
        .iter()
        .map(|&(id, _)| logit(id))
        .fold(f32::MIN, f32::max);
    let total: f32 = emotions
        .iter()
        .map(|&(id, _)| (logit(id) - top).exp())
        .sum();
    emotions
        .iter()
        .max_by(|a, b| logit(a.0).total_cmp(&logit(b.0)))
        .and_then(|&(id, emotion)| Some((emotion?, (logit(id) - top).exp() / total)))
        .unwrap_or((Emotion::Neutral, 0.0))
}

/// `name` in `dir` as the app runs it, in f16, carrying the statistics its
/// filterbanks are normalized with.
fn build(dir: &Path, name: &str) -> TractResult<TypedModel> {
    let mut proto = onnx::read(&dir.join(name))?;
    let metadata: HashMap<String, String> = std::mem::take(&mut proto.metadata_props)
        .into_iter()
        .map(|entry| (entry.key, entry.value))
        .collect();
    let graph = proto.graph.as_mut().context("the model has no graph")?;
    unmask_attention(graph);
    measure_mask_by_input(graph)?;
    let mut model = onnx::typed(
        proto,
        dir,
        name,
        &[
            ("x", None),
            ("x_length", None),
            ("language", None),
            ("text_norm", None),
        ],
        &[],
        Floats::Half,
    )?;
    // As the text the export gives them: NNEF cannot read back a property
    // tensor this large.
    for key in [NEGATIVE_MEANS, INVERSE_DEVIATIONS] {
        let values = metadata
            .get(key)
            .with_context(|| format!("the model has no {key}"))?;
        model
            .properties
            .insert(key.to_owned(), tensor0(values.clone()).into_arc_tensor());
    }
    Ok(model)
}

/// Each attention layer masks the frames past `x_length` with `Where(mask,
/// fill, scores)`. One unpadded stretch at a time has no such frames, so
/// each `Where` gives its scores: dropped, the layers stay on the GPU
/// instead of reading every score back to mask it on the CPU.
fn unmask_attention(graph: &mut GraphProto) {
    let masks = graph
        .node
        .iter_mut()
        .filter(|node| node.op_type == "Where" && node.name.contains("/self_attn/"));
    for node in masks {
        node.op_type = "Identity".into();
        node.input = vec![node.input[2].clone()];
    }
}

/// The encoder's padding mask counts up to the longest `x_length`, a length
/// tract cannot tell equals the input's, so it cannot write the model out in
/// NNEF. One unpadded stretch at a time is exactly as long as the input, so
/// the mask counts up to the input's length instead.
fn measure_mask_by_input(graph: &mut GraphProto) -> Result<()> {
    const ENCODER_INPUT: &str = "/Concat_2_output_0";
    anyhow::ensure!(
        graph
            .node
            .iter()
            .any(|node| node.output.iter().any(|output| output == ENCODER_INPUT)),
        "the model has no {ENCODER_INPUT}"
    );
    let range = graph
        .node
        .iter()
        .position(|node| node.name == "/encoder/Range")
        .context("the model has no padding mask")?;
    let constant = |name: &str, value: i64| NodeProto {
        name: name.into(),
        op_type: "Constant".into(),
        output: vec![name.into()],
        attribute: vec![AttributeProto {
            name: "value".into(),
            r#type: AttributeType::Tensor as i32,
            t: Some(TensorProto {
                data_type: DataType::Int64 as i32,
                int64_data: vec![value],
                ..Default::default()
            }),
            ..Default::default()
        }],
        ..Default::default()
    };
    let node = |name: &str, op_type: &str, input: &[&str]| NodeProto {
        name: name.into(),
        op_type: op_type.into(),
        input: input.iter().map(|&input| input.into()).collect(),
        output: vec![name.into()],
        ..Default::default()
    };
    graph.node[range].input = vec!["mask/zero".into(), "mask/length".into(), "mask/one".into()];
    graph.node.splice(
        range..range,
        [
            constant("mask/zero", 0),
            constant("mask/one", 1),
            node("mask/shape", "Shape", &[ENCODER_INPUT]),
            node("mask/length", "Gather", &["mask/shape", "mask/one"]),
        ],
    );
    Ok(())
}

/// Seven frames at a time every six, the first repeated three times ahead and
/// the last as often as needed after, each value normalized.
fn stack(frames: &[Frame], negative_means: &[f32], inverse_deviations: &[f32]) -> Vec<f32> {
    let count = frames.len().div_ceil(STRIDE);
    let mut features = Vec::with_capacity(count * FEATURES);
    for index in 0..count {
        for offset in 0..STACK {
            let frame = (index * STRIDE + offset)
                .saturating_sub((STACK - 1) / 2)
                .min(frames.len() - 1);
            features.extend(frames[frame].iter().enumerate().map(|(bin, value)| {
                let at = offset * MELS + bin;
                (value + negative_means[at]) * inverse_deviations[at]
            }));
        }
    }
    features
}

fn decode(best: &[usize], tokens: &[String], language_sure: f32) -> Transcript {
    let tag = |index: usize| {
        best.get(index)
            .and_then(|&id| tokens.get(id))
            .map(|token| {
                token
                    .trim_start_matches("<|")
                    .trim_end_matches("|>")
                    .to_owned()
            })
            .unwrap_or_default()
    };
    let mut glyphs: Vec<(char, f64)> = Vec::new();
    let mut previous = BLANK;
    for (output, &id) in best.iter().enumerate().skip(TAGS) {
        let token = tokens.get(id).filter(|token| !token.starts_with("<|"));
        if let Some(token) = token.filter(|_| id != previous && id != BLANK) {
            let at = (output - TAGS) as f64 * OUTPUT_SECONDS;
            glyphs.extend(token.replace('▁', " ").chars().map(|glyph| (glyph, at)));
        }
        previous = id;
    }
    let first = glyphs.iter().position(|(glyph, _)| !glyph.is_whitespace());
    let last = glyphs.iter().rposition(|(glyph, _)| !glyph.is_whitespace());
    let trimmed = match (first, last) {
        (Some(first), Some(last)) => &glyphs[first..=last],
        _ => &[],
    };
    let language = tag(0);
    Transcript {
        language: if language == "nospeech" {
            String::new()
        } else {
            language
        },
        event: tag(2),
        text: trimmed.iter().map(|&(glyph, _)| glyph).collect(),
        said: trimmed.iter().map(|&(_, at)| at).collect(),
        language_sure,
        emotion: Emotion::Neutral,
        emotion_sure: 0.0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sizes_the_padding_mask_by_the_input() {
        let node = |name: &str, op_type: &str, input: &[&str], output: &str| NodeProto {
            name: name.into(),
            op_type: op_type.into(),
            input: input.iter().map(|&input| input.into()).collect(),
            output: vec![output.into()],
            ..Default::default()
        };
        let mut graph = GraphProto {
            node: vec![
                node("/Concat_2", "Concat", &["tags", "x"], "/Concat_2_output_0"),
                node("/encoder/ReduceMax", "ReduceMax", &["x_length"], "longest"),
                node(
                    "/encoder/Range",
                    "Range",
                    &["zero", "longest", "one"],
                    "mask",
                ),
            ],
            ..Default::default()
        };
        measure_mask_by_input(&mut graph).unwrap();

        let ops: Vec<&str> = graph
            .node
            .iter()
            .map(|node| node.op_type.as_str())
            .collect();
        assert_eq!(
            ops,
            [
                "Concat",
                "ReduceMax",
                "Constant",
                "Constant",
                "Shape",
                "Gather",
                "Range"
            ]
        );
        assert_eq!(graph.node[4].input, ["/Concat_2_output_0"]);
        assert_eq!(
            graph.node[6].input,
            ["mask/zero", "mask/length", "mask/one"]
        );
    }

    #[test]
    fn stacks_seven_frames_every_six() {
        let frames: Vec<Frame> = (0..13).map(|i| [i as f32; MELS]).collect();
        let features = stack(&frames, &[0.0; FEATURES], &[1.0; FEATURES]);
        assert_eq!(features.len(), 3 * FEATURES);
        let first_of = |row: usize, offset: usize| features[row * FEATURES + offset * MELS];
        // The first frame stands in for the three before it.
        assert_eq!(
            (0..STACK).map(|o| first_of(0, o)).collect::<Vec<_>>(),
            [0., 0., 0., 0., 1., 2., 3.]
        );
        assert_eq!(first_of(1, 0), 3.0);
        // The last frame stands in for those past the end.
        assert_eq!(first_of(2, 6), 12.0);
    }

    #[test]
    fn passes_attention_scores_through_their_masks() {
        let node = |op_type: &str, name: &str, inputs: &[&str]| tract_onnx::pb::NodeProto {
            name: name.into(),
            op_type: op_type.into(),
            input: inputs.iter().map(|&input| input.into()).collect(),
            ..Default::default()
        };
        let mut graph = GraphProto {
            node: vec![
                node(
                    "Where",
                    "/encoder/encoders.0/self_attn/Where",
                    &["mask", "fill", "scores"],
                ),
                node("Where", "/decoder/Where", &["mask", "fill", "logits"]),
            ],
            ..Default::default()
        };

        unmask_attention(&mut graph);

        assert_eq!(graph.node[0].op_type, "Identity");
        assert_eq!(graph.node[0].input, ["scores"]);
        assert_eq!(graph.node[1].op_type, "Where");
    }

    #[test]
    fn reads_the_tags_then_collapses_the_text() {
        let tokens: Vec<String> = [
            "<unk>",
            "<|zh|>",
            "<|NEUTRAL|>",
            "<|BGM|>",
            "<|withitn|>",
            "你",
            "好",
            "▁ok",
        ]
        .map(str::to_owned)
        .to_vec();
        let transcript = decode(&[1, 2, 3, 4, 5, 5, 0, 5, 6, 6, 7], &tokens, 0.9);
        assert_eq!(
            transcript,
            Transcript {
                language: "zh".into(),
                event: "BGM".into(),
                text: "你你好 ok".into(),
                said: [0, 3, 4, 6, 6, 6]
                    .map(|output| output as f64 * OUTPUT_SECONDS)
                    .to_vec(),
                language_sure: 0.9,
                emotion: Emotion::Neutral,
                emotion_sure: 0.0,
            }
        );
    }

    #[test]
    fn reads_the_emotion_among_the_emotion_tags_alone() {
        let emotions = [
            (1, Some(Emotion::Neutral)),
            (2, Some(Emotion::Happy)),
            (3, None),
        ];
        // The text token at 0 is likelier than any emotion, and is not counted.
        let (emotion, sure) = feeling(&[9.0, 0.0, 2.0, 0.0], &emotions);
        assert_eq!(emotion, Emotion::Happy);
        let expected = 2f32.exp() / (2f32.exp() + 2.0);
        assert!((sure - expected).abs() < 1e-6, "{sure}");

        assert_eq!(
            feeling(&[0.0, 1.0, 0.0, 3.0], &emotions),
            (Emotion::Neutral, 0.0)
        );
    }

    #[test]
    fn takes_only_what_the_model_is_sure_of_the_language_of_for_speech() {
        let heard = |text: &str, language_sure: f32| Transcript {
            language: "en".into(),
            event: "Speech".into(),
            text: text.into(),
            said: Vec::new(),
            language_sure,
            emotion: Emotion::Neutral,
            emotion_sure: 0.0,
        };
        assert!(heard("Good morning.", 0.99).is_speech());
        assert!(!heard("Yeah.", 0.45).is_speech());
        assert!(!heard("。", 0.99).is_speech());
    }
}
