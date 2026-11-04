import { requireAccess } from "@/utils/auth";
import { BackLink } from "@/components/LinkButton";
import { DEFAULT_ROLE_BY_DEPARTMENT } from "@/utils/masterRules";
import { createEmployee } from "../actions";
import { listWorkLocations } from "../employeeData";
import { EmployeeForm } from "../EmployeeForm";

// G02 従業員の新規登録(CMN-02 EV-02)。登録したら G03 へ移る。初期パスワードの発行は G03 で行う
export default async function NewEmployeePage() {
  await requireAccess("employees", "/admin/employees/new");
  // 主な勤務場所の選択肢は使用中の場所だけ
  const locations = (await listWorkLocations()).filter((l) => l.isActive);
  // 所属の初期値は店舗。権限・勤務場所の初期値も店舗に合わせる(【仮】CMN02-仮-02)
  const storeLocation = locations.find((l) => l.kind === "store");

  return (
    <div className="flex flex-col gap-4">
      <div>
        <BackLink href="/admin/employees" label="一覧へ" />
      </div>
      <h1 className="text-2xl font-bold">従業員の新規登録</h1>
      <EmployeeForm
        mode="new"
        action={createEmployee}
        locations={locations}
        initialValues={{
          department: "store",
          employment_type: "full_time",
          uses_timecard: "1",
          roles: DEFAULT_ROLE_BY_DEPARTMENT.store,
          home_location_id: storeLocation?.id ?? "",
        }}
      />
    </div>
  );
}
