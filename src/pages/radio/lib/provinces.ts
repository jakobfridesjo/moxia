/*
 * Where a mainland station is when radio-browser gives it no coordinates: its province's capital,
 * from the province as radio-browser files it. Stations name it in pinyin, in the old postal
 * spellings (Kiangsu, Szechuan), or in Chinese.
 */

/** Each province's capital, in degrees, under every name it goes by. */
const CAPITALS: [string[], [number, number]][] = [
  [
    ["beijing", "peking", "北京"],
    [39.9, 116.4],
  ],
  [
    ["tianjin", "tientsin", "天津"],
    [39.13, 117.2],
  ],
  [
    ["hebei", "hopei", "河北"],
    [38.04, 114.51],
  ],
  [
    ["shanxi", "shansi", "山西"],
    [37.87, 112.55],
  ],
  [
    ["innermongolia", "neimongol", "neimenggu", "内蒙古"],
    [40.84, 111.75],
  ],
  [
    ["liaoning", "辽宁", "遼寧"],
    [41.8, 123.43],
  ],
  [
    ["dalian", "大连", "大連"],
    [38.91, 121.6],
  ],
  [
    ["jilin", "kirin", "吉林"],
    [43.82, 125.32],
  ],
  [
    ["heilongjiang", "heilungkiang", "amurriver", "黑龙江", "黑龍江"],
    [45.8, 126.53],
  ],
  [
    ["shanghai", "上海"],
    [31.23, 121.47],
  ],
  [
    ["jiangsu", "kiangsu", "江苏", "江蘇"],
    [32.06, 118.8],
  ],
  [
    ["zhejiang", "chekiang", "浙江"],
    [30.27, 120.16],
  ],
  [
    ["anhui", "anhwei", "安徽"],
    [31.82, 117.23],
  ],
  [
    ["fujian", "fukien", "福建"],
    [26.07, 119.3],
  ],
  [
    ["jiangxi", "kiangsi", "江西"],
    [28.68, 115.86],
  ],
  [
    ["shandong", "shantung", "山东", "山東"],
    [36.65, 117.12],
  ],
  [
    ["henan", "honan", "河南"],
    [34.75, 113.63],
  ],
  [
    ["hubei", "hupei", "hupeh", "湖北"],
    [30.59, 114.31],
  ],
  [
    ["hunan", "湖南"],
    [28.23, 112.94],
  ],
  [
    ["guangdong", "kwangtung", "guangzhou", "canton", "广东", "廣東", "广州", "廣州"],
    [23.13, 113.26],
  ],
  [
    ["guangxi", "kwangsi", "广西", "廣西"],
    [22.82, 108.37],
  ],
  [
    ["hainan", "海南"],
    [20.04, 110.2],
  ],
  [
    ["chongqing", "chungking", "重庆", "重慶"],
    [29.56, 106.55],
  ],
  [
    ["sichuan", "szechuan", "szechwan", "四川"],
    [30.57, 104.07],
  ],
  [
    ["guizhou", "kweichow", "贵州", "貴州"],
    [26.65, 106.63],
  ],
  [
    ["yunnan", "云南", "雲南"],
    [25.04, 102.71],
  ],
  [
    ["tibet", "xizang", "西藏"],
    [29.65, 91.12],
  ],
  [
    ["shaanxi", "shensi", "陕西", "陝西"],
    [34.34, 108.94],
  ],
  [
    ["gansu", "kansu", "甘肃", "甘肅"],
    [36.06, 103.83],
  ],
  [
    ["qinghai", "tsinghai", "青海"],
    [36.62, 101.78],
  ],
  [
    ["ningxia", "ningsia", "宁夏", "寧夏"],
    [38.49, 106.23],
  ],
  [
    ["xinjiang", "sinkiang", "新疆"],
    [43.83, 87.62],
  ],
];

const BY_NAME = new Map(
  CAPITALS.flatMap(([names, place]) => names.map((name) => [name, place] as const))
);

/** Longest first, so a name that starts with another (shanxi, shaanxi) is found whole. */
const NAMES = [...BY_NAME.keys()].sort((a, b) => b.length - a.length);

/** `state` without case, spaces, punctuation or words like "province" and 省. */
const plain = (state: string) =>
  state
    .toLowerCase()
    .replace(/[^\p{L}]/gu, "")
    .replace(/province|municipality|autonomousregion|[省市]|自治区|自治區/gu, "");

/** Where the capital of the province `state` names is, in degrees; null for one not known. */
export function provinceCapital(state: string | null): [number, number] | null {
  if (!state) return null;
  const name = plain(state);
  const key = BY_NAME.has(name) ? name : NAMES.find((each) => name.startsWith(each));
  return key === undefined ? null : (BY_NAME.get(key) ?? null);
}
