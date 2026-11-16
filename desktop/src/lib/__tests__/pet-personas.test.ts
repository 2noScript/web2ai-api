import { describe, expect, test } from "bun:test";
import { PET_PERSONAS, getPetPersona } from "../pet-personas";

describe("pet-personas", () => {
  test("all 5 pets have non-empty names and system prompts", () => {
    const ids = ["fox", "bot", "cat", "owl", "shiba"] as const;
    for (const id of ids) {
      const persona = getPetPersona(id);
      expect(persona.id).toBe(id);
      expect(persona.name.length).toBeGreaterThan(0);
      expect(persona.systemPrompt.length).toBeGreaterThan(20);
      expect(PET_PERSONAS[id]).toEqual(persona);
    }
  });
});
