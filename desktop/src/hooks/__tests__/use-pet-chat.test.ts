import { describe, expect, test } from "bun:test";
import {
  createSessionId,
  decodePetMessageContent,
  encodePetMessageContent,
} from "../use-pet-chat";

describe("use-pet-chat helpers", () => {
  test("createSessionId generates unique pet-prefixed IDs", () => {
    const a = createSessionId();
    const b = createSessionId();
    expect(a.startsWith("pet-")).toBe(true);
    expect(b.startsWith("pet-")).toBe(true);
    expect(a).not.toBe(b);
  });

  test("encodePetMessageContent & decodePetMessageContent round-trip plain text", () => {
    const encoded = encodePetMessageContent("Hello world");
    expect(encoded).toBe("Hello world");
    expect(decodePetMessageContent(encoded)).toEqual({ content: "Hello world" });
  });

  test("encodePetMessageContent & decodePetMessageContent round-trip text with images", () => {
    const images = ["data:image/png;base64,AAA", "data:image/png;base64,BBB"];
    const encoded = encodePetMessageContent("Inspect these", images);
    expect(decodePetMessageContent(encoded)).toEqual({
      content: "Inspect these",
      images,
    });
  });

  test("decodePetMessageContent gracefully handles malformed JSON", () => {
    const raw = "{not valid json}";
    expect(decodePetMessageContent(raw)).toEqual({ content: raw });
  });
});
