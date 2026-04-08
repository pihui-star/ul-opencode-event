import { describe, test, expect } from "bun:test";
import { renderTemplate } from "../src/template";

describe("renderTemplate", () => {
  test("replaces single variable", () => {
    const result = renderTemplate("Hello {{name}}!", { name: "World" });
    expect(result).toBe("Hello World!");
  });

  test("replaces multiple variables", () => {
    const result = renderTemplate(
      "[{{eventType}}] {{projectName}} - {{timestamp}}",
      {
        eventType: "created",
        projectName: "my-project",
        timestamp: "2024-01-01T00:00:00Z",
      }
    );
    expect(result).toBe("[created] my-project - 2024-01-01T00:00:00Z");
  });

  test("missing variable becomes empty string", () => {
    const result = renderTemplate("Hello {{name}}!", {});
    expect(result).toBe("Hello !");
  });

  test("undefined variable value becomes empty string", () => {
    const result = renderTemplate("Value: {{foo}}", { foo: undefined });
    expect(result).toBe("Value: ");
  });

  test("no variables returns original string", () => {
    const template = "No variables here!";
    const result = renderTemplate(template, { unused: "value" });
    expect(result).toBe(template);
  });

  test("empty template returns empty string", () => {
    const result = renderTemplate("", { name: "test" });
    expect(result).toBe("");
  });

  test("handles mixed present and missing variables", () => {
    const result = renderTemplate(
      "{{a}}-{{b}}-{{c}}",
      { a: "1", c: "3" }
    );
    expect(result).toBe("1--3");
  });

  test("supports all documented variable names", () => {
    const template =
      "{{eventType}} {{timestamp}} {{projectName}} {{sessionId}} {{message}} {{error}} {{duration}}";
    const result = renderTemplate(template, {
      eventType: "idle",
      timestamp: "2024-01-01T00:00:00Z",
      projectName: "test-project",
      sessionId: "session-123",
      message: "Task completed",
      error: undefined,
      duration: "5m",
    });
    expect(result).toBe(
      "idle 2024-01-01T00:00:00Z test-project session-123 Task completed  5m"
    );
  });

  test("replaces projectPath variable", () => {
    const result = renderTemplate("Path: {{projectPath}}", {
      projectPath: "/full/path/to/project",
    });
    expect(result).toBe("Path: /full/path/to/project");
  });
});
