"use client";

import { Tag } from "@ui5/webcomponents-react";
import { t } from "@/lib/i18n/t";

/** Marks a person who holds our skills but has no job title in FSM (not counted as a technician). */
export function NoJobTitleTag() {
  return (
    <Tag design="Critical" wrappingType="Normal" style={{ marginTop: "0.125rem" }}>
      {t("person.noJobTitle")}
    </Tag>
  );
}
