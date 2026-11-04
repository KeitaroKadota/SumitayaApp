"use client";

// 従業員の入力フォーム(CMN-02 G02 新規登録・G03 詳細の基本情報とアカウント欄の入力)。
// G03 では CMN-01 の G07 アカウント欄(サーバーの部品)を accountSlot で受け取り、その中にログインID・権限の入力欄
// (EmployeeAccountFields)を置く。入力欄はこのフォームの状態を context で読む。
import { createContext, useActionState, useContext, useState } from "react";
import { Alert } from "@/components/Alert";
import { Checkbox } from "@/components/Checkbox";
import { Field, fieldDescribedBy } from "@/components/Field";
import { RadioGroup } from "@/components/RadioGroup";
import { Select } from "@/components/Select";
import { SubmitButton } from "@/components/SubmitButton";
import { TextArea } from "@/components/TextArea";
import { TextInput } from "@/components/TextInput";
import { Badge } from "@/components/Badge";
import type { FormState } from "@/utils/formState";
import {
  DEFAULT_LOCATION_KIND_BY_DEPARTMENT,
  DEFAULT_ROLE_BY_DEPARTMENT,
  DEPARTMENTS,
  EMPLOYMENT_TYPES,
  type Department,
} from "@/utils/masterRules";
import { ROLES, ROLE_LABELS } from "@/utils/permissions";

type Location = { id: string; name: string; kind: "store" | "factory" };

type FormContextValue = {
  state: FormState;
  roles: string[];
  setRoles: (roles: string[]) => void;
  readOnly: boolean;
};

const EmployeeFormContext = createContext<FormContextValue | null>(null);

const DEPARTMENT_OPTIONS = Object.entries(DEPARTMENTS).map(([value, label]) => ({ value, label }));
const LOGIN_ID_DESCRIPTION = "空でも登録できます（その場合はログインできません）。";
const EMPLOYMENT_OPTIONS =Object.entries(EMPLOYMENT_TYPES).map(([value, label]) => ({ value, label }));

// ログインID・権限の入力欄(CMN-01 G07 の入力の部分。保存は CMN-02 の「保存する」でまとめて行う)
export function EmployeeAccountFields() {
  const ctx = useContext(EmployeeFormContext);
  if (!ctx) return null;
  const { state, roles, setRoles, readOnly } = ctx;
  const loginError = state.errors.login_id;
  const rolesError = state.errors.roles;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Field id="login_id" label="ログインID" description={LOGIN_ID_DESCRIPTION} error={loginError}>
        <TextInput
          id="login_id"
          name="login_id"
          autoComplete="off"
          defaultValue={state.values.login_id ?? ""}
          invalid={!!loginError}
          readOnly={readOnly}
          aria-describedby={fieldDescribedBy("login_id", { description: LOGIN_ID_DESCRIPTION, error: loginError })}
        />
      </Field>
      <fieldset className="flex flex-col gap-1" aria-describedby={rolesError ? "roles-error" : undefined}>
        <legend className="flex items-center gap-2 text-sm font-bold">
          権限
          <Badge tone="required">必須</Badge>
        </legend>
        <div className="flex flex-wrap gap-x-4">
          {ROLES.map((role) => (
            <Checkbox
              key={role}
              name="roles"
              value={role}
              label={ROLE_LABELS[role]}
              checked={roles.includes(role)}
              disabled={readOnly}
              onChange={(e) =>
                setRoles(e.currentTarget.checked ? [...roles, role] : roles.filter((r) => r !== role))
              }
            />
          ))}
        </div>
        {rolesError && (
          <p id="roles-error" className="text-sm text-danger">
            ⚠ {rolesError}
          </p>
        )}
      </fieldset>
    </div>
  );
}

export function EmployeeForm({
  mode,
  action,
  initialValues,
  locations,
  readOnly = false,
  accountSlot,
}: {
  mode: "new" | "edit";
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  initialValues: Record<string, string>;
  locations: Location[];
  readOnly?: boolean;
  accountSlot?: React.ReactNode;
}) {
  const [state, formAction] = useActionState(action, { errors: {}, formError: null, values: initialValues });
  const v = state.values;
  const e = state.errors;

  const [department, setDepartment] = useState(initialValues.department ?? "store");
  const [roles, setRoles] = useState<string[]>(
    initialValues.roles ? initialValues.roles.split(",") : [DEFAULT_ROLE_BY_DEPARTMENT.store]
  );
  const [locationId, setLocationId] = useState(initialValues.home_location_id ?? "");

  // G02: 所属を選ぶと、権限と主な勤務場所に初期値が入る(【仮】00_仮決め一覧 CMN02-仮-02)
  const changeDepartment = (value: string) => {
    setDepartment(value);
    if (mode !== "new" || !(value in DEPARTMENTS)) return;
    const dept = value as Department;
    setRoles([DEFAULT_ROLE_BY_DEPARTMENT[dept]]);
    const kind = DEFAULT_LOCATION_KIND_BY_DEPARTMENT[dept];
    setLocationId(kind ? (locations.find((l) => l.kind === kind)?.id ?? "") : "");
  };

  return (
    <EmployeeFormContext.Provider value={{ state, roles, setRoles, readOnly }}>
      <form action={formAction} className="flex flex-col gap-6">
        {state.formError && <Alert tone="error">{state.formError}</Alert>}

        <fieldset disabled={readOnly} className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5">
          <legend className="sr-only">基本情報</legend>
          <h2 className="text-lg font-bold">基本情報</h2>
          <div className="grid gap-4 md:grid-cols-3">
            <Field id="employee_code" label="社員番号" required error={e.employee_code}>
              <TextInput
                id="employee_code"
                name="employee_code"
                required
                defaultValue={v.employee_code ?? ""}
                invalid={!!e.employee_code}
                aria-describedby={fieldDescribedBy("employee_code", { error: e.employee_code })}
              />
            </Field>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Field id="last_name" label="姓" required error={e.last_name}>
              <TextInput
                id="last_name"
                name="last_name"
                required
                placeholder="例: 山田"
                defaultValue={v.last_name ?? ""}
                invalid={!!e.last_name}
                aria-describedby={fieldDescribedBy("last_name", { error: e.last_name })}
              />
            </Field>
            <Field id="first_name" label="名" required>
              <TextInput
                id="first_name"
                name="first_name"
                required
                placeholder="例: 太郎"
                defaultValue={v.first_name ?? ""}
                invalid={!!e.last_name}
              />
            </Field>
            <Field id="last_name_kana" label="せい" error={e.last_name_kana}>
              <TextInput
                id="last_name_kana"
                name="last_name_kana"
                placeholder="例: やまだ"
                defaultValue={v.last_name_kana ?? ""}
                invalid={!!e.last_name_kana}
                aria-describedby={fieldDescribedBy("last_name_kana", { error: e.last_name_kana })}
              />
            </Field>
            <Field id="first_name_kana" label="めい">
              <TextInput
                id="first_name_kana"
                name="first_name_kana"
                placeholder="例: たろう"
                defaultValue={v.first_name_kana ?? ""}
                invalid={!!e.last_name_kana}
              />
            </Field>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <RadioGroup
              name="department"
              label="所属"
              required
              options={DEPARTMENT_OPTIONS}
              value={department}
              onChange={changeDepartment}
              error={e.department}
            />
            <RadioGroup
              name="employment_type"
              label="雇用形態"
              required
              options={EMPLOYMENT_OPTIONS}
              defaultValue={v.employment_type ?? "full_time"}
              error={e.employment_type}
            />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Field id="email" label="メール" error={e.email}>
              <TextInput
                id="email"
                name="email"
                type="email"
                autoComplete="off"
                defaultValue={v.email ?? ""}
                invalid={!!e.email}
                aria-describedby={fieldDescribedBy("email", { error: e.email })}
              />
            </Field>
            <Field id="hired_on" label="入社日" error={e.hired_on}>
              <TextInput
                id="hired_on"
                name="hired_on"
                type="date"
                defaultValue={v.hired_on ?? ""}
                invalid={!!e.hired_on}
                aria-describedby={fieldDescribedBy("hired_on", { error: e.hired_on })}
              />
            </Field>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Checkbox
              name="uses_timecard"
              value="1"
              label="勤怠（打刻）の対象"
              defaultChecked={v.uses_timecard === "1"}
            />
            {/* 打刻の場所(E-01 の work_locations)が1件も無いときは欄を出さない */}
            {locations.length > 0 && (
              <Field id="home_location_id" label="主な勤務場所" error={e.home_location_id}>
                <Select
                  id="home_location_id"
                  name="home_location_id"
                  value={locationId}
                  onChange={(ev) => setLocationId(ev.currentTarget.value)}
                  invalid={!!e.home_location_id}
                  aria-describedby={fieldDescribedBy("home_location_id", { error: e.home_location_id })}
                >
                  <option value="">（なし）</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </div>
          {mode === "new" && <EmployeeAccountFields />}
          <Field id="note" label="メモ" error={e.note}>
            <TextArea
              id="note"
              name="note"
              defaultValue={v.note ?? ""}
              invalid={!!e.note}
              aria-describedby={fieldDescribedBy("note", { error: e.note })}
            />
          </Field>
        </fieldset>

        {accountSlot}

        {!readOnly && (
          <div className="flex justify-end">
            <SubmitButton pendingText={mode === "new" ? "登録中…" : "保存中…"}>
              {mode === "new" ? "登録する" : "保存する"}
            </SubmitButton>
          </div>
        )}
      </form>
    </EmployeeFormContext.Provider>
  );
}
