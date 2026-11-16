"use client";

import { useState } from "react";
import { Bar, BusyIndicator, Button, Dialog, Input, Label, MessageStrip, TextArea } from "@ui5/webcomponents-react";
import { MAX_SKILL_NAME_LENGTH, validateSkillName } from "@/lib/domain/validation";
import { createSkillDefinition, updateSkillDefinition } from "@/lib/skills/repository";
import { toUserMessage } from "@/lib/errors";
import { createOperationLock } from "@/lib/operationLock";
import type { SkillDefinition } from "@/lib/skills/types";

interface SkillDialogProps {
  /** null = create a new skill */
  skill: SkillDefinition | null;
  existingNames: string[];
  onSaved: (name: string) => Promise<void>;
  onClose: () => void;
}

export function SkillDialog({ skill, existingNames, onSaved, onClose }: SkillDialogProps) {
  const [name, setName] = useState(skill?.name ?? "");
  const [description, setDescription] = useState(skill?.description ?? "");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** A fast second click (or Enter) must not create the skill twice. */
  const [lock] = useState(createOperationLock);

  const otherNames = existingNames.filter((n) => n !== skill?.name);
  const nameError = validateSkillName(name, otherNames);

  const save = async () => {
    const saved = await lock.run(async () => {
      setTouched(true);
      if (nameError) return false;
      setBusy(true);
      setError(null);
      try {
        if (skill) await updateSkillDefinition(skill.id, name.trim(), description);
        else await createSkillDefinition(name.trim(), description);
        await onSaved(name.trim());
        return true;
      } catch (e) {
        setError(toUserMessage(e));
        return false;
      } finally {
        setBusy(false);
      }
    });
    // After the lock is released: UI5's before-close check must not block this close.
    if (saved) onClose();
  };

  return (
    <Dialog
      open
      headerText={skill ? `Edit skill “${skill.name}”` : "Create skill"}
      onBeforeClose={(e) => (busy || lock.running) && e.preventDefault()}
      onClose={onClose}
      style={{ width: "min(30rem, 100vw)" }}
      footer={
        <Bar
          design="Footer"
          endContent={
            <>
              <Button design="Emphasized" onClick={save} disabled={busy}>
                {skill ? "Save" : "Create"}
              </Button>
              <Button design="Transparent" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
            </>
          }
        />
      }
    >
      <BusyIndicator active={busy} delay={0} style={{ display: "block" }}>
        <form
          style={{ display: "grid", gap: "0.75rem" }}
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div style={{ display: "grid", gap: "0.25rem" }}>
            <Label for="skill-name" required showColon>
              Name
            </Label>
            <Input
              id="skill-name"
              value={name}
              maxlength={MAX_SKILL_NAME_LENGTH}
              placeholder="e.g. Welding (steel)"
              onInput={(e) => setName(e.target.value ?? "")}
              onChange={() => setTouched(true)}
              valueState={touched && nameError ? "Negative" : "None"}
              valueStateMessage={<div>{nameError}</div>}
              style={{ width: "100%" }}
            />
          </div>
          <div style={{ display: "grid", gap: "0.25rem" }}>
            <Label for="skill-description" showColon>
              Description (optional)
            </Label>
            <TextArea id="skill-description" value={description} rows={3} maxlength={500} onInput={(e) => setDescription(e.target.value ?? "")} />
          </div>
          {error && (
            <MessageStrip design="Negative" onClose={() => setError(null)}>
              {error}
            </MessageStrip>
          )}
          {/* lets Enter in the name field submit the form */}
          <button type="submit" hidden />
        </form>
      </BusyIndicator>
    </Dialog>
  );
}
