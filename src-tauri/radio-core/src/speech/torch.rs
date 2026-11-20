//! Reads the float tensors of a PyTorch checkpoint (`torch.save`'s zip of a
//! pickle and raw storages) without running it: the pickle is only walked
//! for the shapes and storages of `model_state_dict`, and anything it would
//! call besides rebuilding a tensor is refused.

use std::collections::HashMap;
use std::io::{Read, Seek, SeekFrom};

use anyhow::{Context, Result, bail, ensure};

pub struct Tensor {
    pub shape: Vec<usize>,
    pub data: Vec<f32>,
}

/// The tensors under `model_state_dict`, by name.
pub fn state_dict(mut file: impl Read + Seek) -> Result<HashMap<String, Tensor>> {
    let entries = zip_entries(&mut file)?;
    let pickle = entries
        .keys()
        .find(|name| name.ends_with("/data.pkl"))
        .context("the checkpoint has no data.pkl")?
        .clone();
    let prefix = pickle.trim_end_matches("data.pkl").to_owned();
    let root = unpickle(&read_entry(&mut file, &entries[&pickle])?)?;
    let Value::Dict(items) = root else {
        bail!("the checkpoint is not a dictionary");
    };
    let state = items
        .into_iter()
        .find_map(|(key, value)| (key == Value::Str("model_state_dict".into())).then_some(value))
        .context("the checkpoint has no model_state_dict")?;
    let Value::Dict(tensors) = state else {
        bail!("model_state_dict is not a dictionary");
    };
    tensors
        .into_iter()
        .map(|(name, value)| {
            let Value::Str(name) = name else {
                bail!("a tensor has no name");
            };
            let tensor = rebuild(value, |key| {
                let entry = entries
                    .get(&format!("{prefix}data/{key}"))
                    .with_context(|| format!("storage {key} is missing"))?;
                read_entry(&mut file, entry)
            })
            .with_context(|| format!("tensor {name}"))?;
            Ok((name, tensor))
        })
        .collect()
}

/// A tensor from `_rebuild_tensor_v2(storage, offset, shape, stride, …)`, read contiguous.
fn rebuild(value: Value, mut storage: impl FnMut(&str) -> Result<Vec<u8>>) -> Result<Tensor> {
    let Value::Call(function, arguments) = value else {
        bail!("not a tensor");
    };
    ensure!(
        *function == Value::Global("torch._utils _rebuild_tensor_v2".into()),
        "not a tensor"
    );
    let Value::Tuple(arguments) = *arguments else {
        bail!("not a tensor");
    };
    let [
        Value::Persistent(id),
        Value::Int(offset),
        Value::Tuple(shape),
        Value::Tuple(stride),
        ..,
    ] = arguments.as_slice()
    else {
        bail!("not a tensor");
    };
    let Value::Tuple(id) = id.as_ref() else {
        bail!("not a storage");
    };
    let [_, kind, Value::Str(key), ..] = id.as_slice() else {
        bail!("not a storage");
    };
    ensure!(
        *kind == Value::Global("torch FloatStorage".into()),
        "only float tensors are read"
    );
    let numbers = |values: &[Value]| -> Result<Vec<usize>> {
        values
            .iter()
            .map(|value| match value {
                Value::Int(n) => Ok(usize::try_from(*n)?),
                _ => bail!("not a size"),
            })
            .collect()
    };
    let (shape, stride) = (numbers(shape)?, numbers(stride)?);
    let floats: Vec<f32> = storage(key)?
        .as_chunks::<4>()
        .0
        .iter()
        .map(|&bytes| f32::from_le_bytes(bytes))
        .collect();
    let count: usize = shape.iter().product();
    let offset = usize::try_from(*offset)?;
    let data = (0..count)
        .map(|flat| {
            let mut rest = flat;
            let mut at = offset;
            for (size, step) in shape.iter().zip(&stride).rev() {
                at += (rest % size) * step;
                rest /= size;
            }
            floats
                .get(at)
                .copied()
                .context("a tensor runs past its storage")
        })
        .collect::<Result<_>>()?;
    Ok(Tensor { shape, data })
}

#[derive(Debug, Clone, PartialEq)]
enum Value {
    None,
    Bool(bool),
    Int(i64),
    Float(f64),
    Str(String),
    Tuple(Vec<Value>),
    List(Vec<Value>),
    Dict(Vec<(Value, Value)>),
    /// A module and name, as `GLOBAL` names them.
    Global(String),
    Persistent(Box<Value>),
    /// What a call would make, left uncalled.
    Call(Box<Value>, Box<Value>),
    /// An object built from a class and state, left as both.
    Built(Box<Value>, Box<Value>),
    Mark,
}

/// The only callables a checkpoint may name; it is never called, only read.
const ALLOWED_GLOBALS: [&str; 4] = [
    "collections OrderedDict",
    "torch._utils _rebuild_tensor_v2",
    "torch FloatStorage",
    "argparse Namespace",
];

fn unpickle(bytes: &[u8]) -> Result<Value> {
    let mut stack: Vec<Value> = Vec::new();
    let mut memo: HashMap<u32, Value> = HashMap::new();
    let mut at = 0;
    let take = |at: &mut usize, count: usize| -> Result<&[u8]> {
        let slice = bytes
            .get(*at..*at + count)
            .context("the pickle ends early")?;
        *at += count;
        Ok(slice)
    };
    let u32_at =
        |at: &mut usize| -> Result<u32> { Ok(u32::from_le_bytes(take(at, 4)?.try_into()?)) };
    let pop = |stack: &mut Vec<Value>| stack.pop().context("the pickle's stack is empty");
    let since_mark = |stack: &mut Vec<Value>| -> Result<Vec<Value>> {
        let mark = stack
            .iter()
            .rposition(|value| *value == Value::Mark)
            .context("the pickle has no mark")?;
        let items = stack.split_off(mark + 1);
        stack.pop();
        Ok(items)
    };
    loop {
        let opcode = take(&mut at, 1)?[0];
        match opcode {
            0x80 => at += 1,                                                 // PROTO
            0x95 => at += 8,                                                 // FRAME
            b'.' => return pop(&mut stack),                                  // STOP
            b'(' => stack.push(Value::Mark),                                 // MARK
            b'N' => stack.push(Value::None),                                 // NONE
            0x88 => stack.push(Value::Bool(true)),                           // NEWTRUE
            0x89 => stack.push(Value::Bool(false)),                          // NEWFALSE
            b'}' => stack.push(Value::Dict(Vec::new())),                     // EMPTY_DICT
            b']' => stack.push(Value::List(Vec::new())),                     // EMPTY_LIST
            b')' => stack.push(Value::Tuple(Vec::new())),                    // EMPTY_TUPLE
            b'K' => stack.push(Value::Int(i64::from(take(&mut at, 1)?[0]))), // BININT1
            b'M' => {
                // BININT2
                let n = u16::from_le_bytes(take(&mut at, 2)?.try_into()?);
                stack.push(Value::Int(i64::from(n)));
            }
            b'J' => {
                // BININT
                let n = i32::from_le_bytes(take(&mut at, 4)?.try_into()?);
                stack.push(Value::Int(i64::from(n)));
            }
            b'G' => {
                // BINFLOAT
                let n = f64::from_be_bytes(take(&mut at, 8)?.try_into()?);
                stack.push(Value::Float(n));
            }
            b'X' | 0x8c => {
                // BINUNICODE, SHORT_BINUNICODE
                let length = if opcode == b'X' {
                    u32_at(&mut at)? as usize
                } else {
                    usize::from(take(&mut at, 1)?[0])
                };
                stack.push(Value::Str(String::from_utf8(
                    take(&mut at, length)?.to_vec(),
                )?));
            }
            b'c' => {
                // GLOBAL: module and name, each ending in a newline
                let rest = &bytes[at..];
                let mut lines = rest.splitn(3, |&byte| byte == b'\n');
                let (Some(module), Some(name)) = (lines.next(), lines.next()) else {
                    bail!("the pickle ends early");
                };
                at += module.len() + name.len() + 2;
                let global = format!(
                    "{} {}",
                    std::str::from_utf8(module)?,
                    std::str::from_utf8(name)?
                );
                ensure!(
                    ALLOWED_GLOBALS.contains(&global.as_str()),
                    "the checkpoint names {global}, which is not read"
                );
                stack.push(Value::Global(global));
            }
            b'q' => {
                // BINPUT
                let key = u32::from(take(&mut at, 1)?[0]);
                memo.insert(key, stack.last().context("nothing to memoize")?.clone());
            }
            b'r' => {
                // LONG_BINPUT
                let key = u32_at(&mut at)?;
                memo.insert(key, stack.last().context("nothing to memoize")?.clone());
            }
            b'h' | b'j' => {
                // BINGET, LONG_BINGET
                let key = if opcode == b'h' {
                    u32::from(take(&mut at, 1)?[0])
                } else {
                    u32_at(&mut at)?
                };
                stack.push(memo.get(&key).context("an unknown memo")?.clone());
            }
            b't' => {
                // TUPLE
                let items = since_mark(&mut stack)?;
                stack.push(Value::Tuple(items));
            }
            0x85..=0x87 => {
                // TUPLE1, TUPLE2, TUPLE3
                let count = usize::from(opcode - 0x84);
                ensure!(stack.len() >= count, "the pickle's stack is empty");
                let items = stack.split_off(stack.len() - count);
                stack.push(Value::Tuple(items));
            }
            b'Q' => {
                // BINPERSID
                let id = pop(&mut stack)?;
                stack.push(Value::Persistent(Box::new(id)));
            }
            b'R' | 0x81 => {
                // REDUCE, NEWOBJ: kept as the call, never made
                let arguments = pop(&mut stack)?;
                let function = pop(&mut stack)?;
                stack.push(Value::Call(Box::new(function), Box::new(arguments)));
            }
            b'b' => {
                // BUILD
                let state = pop(&mut stack)?;
                let object = pop(&mut stack)?;
                stack.push(Value::Built(Box::new(object), Box::new(state)));
            }
            b's' | b'u' => {
                // SETITEM, SETITEMS
                let items = if opcode == b's' {
                    let value = pop(&mut stack)?;
                    let key = pop(&mut stack)?;
                    vec![key, value]
                } else {
                    since_mark(&mut stack)?
                };
                let pairs = items
                    .as_chunks::<2>()
                    .0
                    .iter()
                    .map(|[key, value]| (key.clone(), value.clone()));
                match stack.last_mut() {
                    Some(Value::Dict(dict)) => dict.extend(pairs),
                    // An OrderedDict is made empty, then filled.
                    Some(Value::Call(_, _)) => {
                        let Some(Value::Call(_, _)) = stack.pop() else {
                            unreachable!()
                        };
                        stack.push(Value::Dict(pairs.collect()));
                    }
                    _ => bail!("items set on something not a dictionary"),
                }
            }
            b'a' | b'e' => {
                // APPEND, APPENDS
                let items = if opcode == b'a' {
                    vec![pop(&mut stack)?]
                } else {
                    since_mark(&mut stack)?
                };
                let Some(Value::List(list)) = stack.last_mut() else {
                    bail!("items appended to something not a list");
                };
                list.extend(items);
            }
            other => bail!("the pickle uses opcode {other:#04x}, which is not read"),
        }
    }
}

struct Entry {
    offset: u64,
    size: u64,
}

/// The stored (uncompressed) files of a zip, by name, as `torch.save` writes them.
fn zip_entries(file: &mut (impl Read + Seek)) -> Result<HashMap<String, Entry>> {
    const END: u32 = 0x0605_4b50;
    const CENTRAL: u32 = 0x0201_4b50;
    let length = file.seek(SeekFrom::End(0))?;
    let tail_length = length.min(66_000);
    file.seek(SeekFrom::Start(length - tail_length))?;
    let mut tail = vec![0; usize::try_from(tail_length)?];
    file.read_exact(&mut tail)?;
    let end = (0..tail.len().saturating_sub(21))
        .rev()
        .find(|&i| u32_at(&tail, i) == END)
        .context("the checkpoint is not a zip")?;
    let count = usize::from(u16_at(&tail, end + 10));
    let directory_size = u32_at(&tail, end + 12);
    let directory_offset = u32_at(&tail, end + 16);
    file.seek(SeekFrom::Start(u64::from(directory_offset)))?;
    let mut directory = vec![0; directory_size as usize];
    file.read_exact(&mut directory)?;
    let mut entries = HashMap::with_capacity(count);
    let mut at = 0;
    for _ in 0..count {
        ensure!(
            u32_at(&directory, at) == CENTRAL,
            "the zip's directory is damaged"
        );
        ensure!(
            u16_at(&directory, at + 10) == 0,
            "the checkpoint is compressed"
        );
        let size = u32_at(&directory, at + 20);
        let name_length = usize::from(u16_at(&directory, at + 28));
        let extra_length = usize::from(u16_at(&directory, at + 30));
        let comment_length = usize::from(u16_at(&directory, at + 32));
        let header = u32_at(&directory, at + 42);
        let name = String::from_utf8(directory[at + 46..at + 46 + name_length].to_vec())?;
        let mut local = [0; 30];
        file.seek(SeekFrom::Start(u64::from(header)))?;
        file.read_exact(&mut local)?;
        let skip = 30 + u64::from(u16_at(&local, 26)) + u64::from(u16_at(&local, 28));
        entries.insert(
            name,
            Entry {
                offset: u64::from(header) + skip,
                size: u64::from(size),
            },
        );
        at += 46 + name_length + extra_length + comment_length;
    }
    Ok(entries)
}

fn read_entry(file: &mut (impl Read + Seek), entry: &Entry) -> Result<Vec<u8>> {
    file.seek(SeekFrom::Start(entry.offset))?;
    let mut bytes = vec![0; usize::try_from(entry.size)?];
    file.read_exact(&mut bytes)?;
    Ok(bytes)
}

fn u16_at(bytes: &[u8], at: usize) -> u16 {
    u16::from_le_bytes([bytes[at], bytes[at + 1]])
}

fn u32_at(bytes: &[u8], at: usize) -> u32 {
    u32::from_le_bytes([bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]])
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `{"model_state_dict": OrderedDict(w=tensor)}` as protocol 2 pickles it, the 2×2
    /// tensor transposed, reading storage "0" with strides (1, 2).
    fn pickle(global: &str) -> Vec<u8> {
        let text = |s: &str| {
            let mut bytes = vec![b'X'];
            bytes.extend((s.len() as u32).to_le_bytes());
            bytes.extend(s.as_bytes());
            bytes
        };
        let mut p = vec![0x80, 2, b'}', b'('];
        p.extend(text("model_state_dict"));
        p.extend(b"ccollections\nOrderedDict\n)R(");
        p.extend(text("w"));
        p.extend(b"ctorch._utils\n_rebuild_tensor_v2\n((");
        p.extend(text("storage"));
        p.extend(format!("c{global}\n").replace(' ', "\n").as_bytes());
        p.extend(text("0"));
        p.extend(text("cpu"));
        p.extend([
            b'K', 4, b't', b'Q', b'K', 0, b'K', 2, b'K', 2, 0x86, b'K', 1, b'K', 2, 0x86,
        ]);
        p.extend([0x89, b't', b'R', b'u', b'u', b'.']);
        p
    }

    #[test]
    fn rebuilds_a_strided_tensor_from_its_storage() {
        let Value::Dict(root) = unpickle(&pickle("torch FloatStorage")).unwrap() else {
            panic!("not a dictionary");
        };
        let Value::Dict(tensors) = root[0].1.clone() else {
            panic!("no state dict");
        };
        let storage: Vec<u8> = [1.0f32, 2.0, 3.0, 4.0]
            .iter()
            .flat_map(|f| f.to_le_bytes())
            .collect();
        let tensor = rebuild(tensors[0].1.clone(), |key| {
            assert_eq!(key, "0");
            Ok(storage.clone())
        })
        .unwrap();
        assert_eq!(tensor.shape, [2, 2]);
        assert_eq!(tensor.data, [1.0, 3.0, 2.0, 4.0]);
    }

    #[test]
    fn refuses_a_pickle_that_names_anything_else() {
        let error = unpickle(&pickle("os system")).unwrap_err();
        assert!(error.to_string().contains("os system"), "{error}");
    }
}
