// AIの答えの形(JSONスキーマの小さな形)と、その形での確かめ方(D-01 04 CH-08)。
// 同じ形を Gemini の「JSONで答える」設定(responseJsonSchema)にも渡す(src/utils/gemini.ts)。
// DBを読まない計算だけのファイル。

export type AiSchema =
  | {
      type: "string";
      description?: string;
      nullable?: boolean;
      // 決まった値の一覧。enumCheck が "keep" のときは、こちらでは値を確かめず、呼んだ機能が確かめる(D-01 CH-09)
      enum?: readonly string[];
      enumCheck?: "drop" | "keep";
      // 超えた部分は切る(CH-08)
      maxLength?: number;
    }
  | { type: "integer" | "number" | "boolean"; description?: string; nullable?: boolean }
  | { type: "array"; description?: string; nullable?: boolean; items: AiSchema; maxItems?: number }
  | {
      type: "object";
      description?: string;
      nullable?: boolean;
      properties: Record<string, AiSchema>;
      required?: readonly string[];
    };

// Gemini の「JSONで答える」設定(generationConfig.responseJsonSchema)に渡す JSON スキーマの形に直す。
// 空可(nullable)は type に "null" を足す。長さの上限は Gemini 側では守られないので、こちらで切る(CH-08)
export const toGeminiSchema = (schema: AiSchema): Record<string, unknown> => {
  const base: Record<string, unknown> = { type: schema.nullable ? [schema.type, "null"] : schema.type };
  if (schema.description) base.description = schema.description;
  switch (schema.type) {
    case "string":
      if (schema.enum) base.enum = schema.nullable ? [...schema.enum, null] : [...schema.enum];
      return base;
    case "array":
      base.items = toGeminiSchema(schema.items);
      if (schema.maxItems !== undefined) base.maxItems = schema.maxItems;
      return base;
    case "object":
      base.properties = Object.fromEntries(Object.entries(schema.properties).map(([k, v]) => [k, toGeminiSchema(v)]));
      if (schema.required && schema.required.length > 0) base.required = [...schema.required];
      return base;
    default:
      return base;
  }
};

// 確かめられなかった印(合わない項目は捨てる)
const DROP = Symbol("drop");
type Checked = unknown | typeof DROP;

// CH-08: 形に合わない項目は捨て、必須の項目が無ければ全体を「形がおかしい」にする。長すぎる文字は切る
const check = (schema: AiSchema, value: unknown): Checked => {
  if (value === null || value === undefined) return schema.nullable ? null : DROP;
  switch (schema.type) {
    case "string": {
      if (typeof value !== "string") return DROP;
      if (schema.enum && schema.enumCheck !== "keep" && !schema.enum.includes(value)) return DROP;
      return schema.maxLength !== undefined ? value.slice(0, schema.maxLength) : value;
    }
    case "integer":
      return typeof value === "number" && Number.isInteger(value) ? value : DROP;
    case "number":
      return typeof value === "number" && Number.isFinite(value) ? value : DROP;
    case "boolean":
      return typeof value === "boolean" ? value : DROP;
    case "array": {
      if (!Array.isArray(value)) return DROP;
      const items = value.map((v) => check(schema.items, v)).filter((v) => v !== DROP);
      return schema.maxItems !== undefined ? items.slice(0, schema.maxItems) : items;
    }
    case "object": {
      if (typeof value !== "object" || Array.isArray(value)) return DROP;
      const src = value as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const [key, sub] of Object.entries(schema.properties)) {
        if (!(key in src)) continue;
        const v = check(sub, src[key]);
        if (v !== DROP) out[key] = v;
      }
      if ((schema.required ?? []).some((key) => !(key in out))) return DROP;
      return out;
    }
  }
};

// 形に合えば整えた値を、合わなければ null を返す
export const validateAiJson = (schema: AiSchema, value: unknown): { ok: true; value: unknown } | { ok: false } => {
  const v = check(schema, value);
  return v === DROP ? { ok: false } : { ok: true, value: v };
};
