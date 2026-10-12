import { z } from "zod";

export const LOCAL_TENANT_ID = "00000000-0000-4000-8000-000000000001";

export const locatorSchema = z.discriminatedUnion("strategy", [
  z.object({ strategy: z.literal("role"), role: z.string().min(1), name: z.string().min(1) }),
  z.object({ strategy: z.literal("label"), text: z.string().min(1) }),
  z.object({ strategy: z.literal("placeholder"), text: z.string().min(1) }),
  z.object({ strategy: z.literal("text"), text: z.string().min(1) }),
  z.object({ strategy: z.literal("testid"), value: z.string().min(1) }),
  z.object({ strategy: z.literal("id"), value: z.string().min(1) }),
  z.object({ strategy: z.literal("name"), value: z.string().min(1) }),
  z.object({ strategy: z.literal("css"), value: z.string().min(1) }),
  z.object({ strategy: z.literal("xpath"), value: z.string().min(1) }),
]);

export const expectSchema = z
  .object({
    textContains: z.string().min(1).optional(),
    textAbsent: z.string().min(1).optional(),
    visible: z.boolean().optional(),
  })
  .refine((value) => value.textContains || value.textAbsent || value.visible !== undefined, {
    message: "An assertion needs textContains, textAbsent, or visible",
  });

export const stepSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["goto", "click", "dblclick", "fill", "select", "press", "assert", "guard", "upload", "dialog"]),
  description: z.string().optional(),
  url: z.string().optional(),
  framePath: z.array(z.string()).default([]),
  locators: z.array(locatorSchema).default([]),
  value: z.string().optional(),
  key: z.string().optional(),
  commit: z.boolean().optional(),
  flags: z.array(z.string()).optional(),
  expect: expectSchema.optional(),
  onFail: z.enum(["already-done", "fail"]).optional(),
  needsFile: z.boolean().optional(),
  scrollIntoView: z.boolean().optional(),
});

export const variableSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["string", "number"]).default("string"),
  default: z.string(),
});

export const workflowSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  name: z.string().min(1),
  startUrl: z.string().min(1),
  timezone: z.string().min(1).default("Asia/Kolkata"),
  variables: z.array(variableSchema).default([]),
  steps: z.array(stepSchema),
});

export type Locator = z.infer<typeof locatorSchema>;
export type Step = z.infer<typeof stepSchema>;
export type Workflow = z.infer<typeof workflowSchema>;
export type WorkflowVariable = z.infer<typeof variableSchema>;

export function parseWorkflow(input: unknown): Workflow {
  return workflowSchema.parse(input);
}
