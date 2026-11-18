"use client";

import { MultiComboBox, MultiComboBoxItem } from "@ui5/webcomponents-react";
import { NO_JOB_TITLE } from "@/lib/domain/jobTitleFilter";
import { t } from "@/lib/i18n/t";

interface JobTitleFilterProps {
  /** For the field's Label. */
  id: string;
  options: string[];
  selected: string[];
  onChange: (titles: string[]) => void;
}

/** The "Job title" choice of the matrix and Find technician; nothing selected shows everyone. */
export function JobTitleFilter({ id, options, selected, onChange }: JobTitleFilterProps) {
  return (
    <MultiComboBox id={id} placeholder={t("matrix.allJobTitles")} onSelectionChange={(e) => onChange(e.detail.items.map((i) => String(i.dataset.id)))}>
      {options.map((title) => (
        <MultiComboBoxItem
          key={title}
          data-id={title}
          text={title === NO_JOB_TITLE ? t("matrix.noJobTitle") : title}
          selected={selected.includes(title)}
        />
      ))}
    </MultiComboBox>
  );
}
