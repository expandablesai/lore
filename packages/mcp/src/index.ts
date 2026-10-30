/**
 * @lore/mcp — MCP tool definitions for the LORE memory system.
 *
 * Skeleton: tool name constants and Zod input schemas only.
 */
import { z } from "zod";

// Tool names

export const MEMORY_RECALL = "memory_recall";
export const MEMORY_REMEMBER = "memory_remember";
export const MEMORY_CONFIRM = "memory_confirm";
export const MEMORY_FORGET = "memory_forget";
export const MEMORY_CONFLICTS = "memory_conflicts";
export const MEMORY_AUDIT = "memory_audit";
export const MEMORY_EXPORT = "memory_export";
export const MEMORY_ANSWER = "memory_answer";

// Input schemas

export const memoryRecallInput = z.object({
  query: z.string().min(1),
  scope: z.string().min(1),
  as_of: z.string().datetime().optional(),
  budget_tokens: z.number().int().positive().optional(),
});
export type MemoryRecallInput = z.infer<typeof memoryRecallInput>;

export const memoryRememberInput = z.object({
  assertions: z.array(z.string().min(1)).min(1),
  scope: z.string().min(1),
  audience: z.string().min(1),
  sensitivity: z.string().min(1),
});
export type MemoryRememberInput = z.infer<typeof memoryRememberInput>;

export const memoryConfirmInput = z.object({
  ids: z.array(z.string().min(1)).min(1),
});
export type MemoryConfirmInput = z.infer<typeof memoryConfirmInput>;

/** Requires at least one of `ids` or `query`; `cascade` defaults to true. */
export const memoryForgetInput = z
  .object({
    ids: z.array(z.string().min(1)).min(1).optional(),
    query: z.string().min(1).optional(),
    cascade: z.boolean().default(true),
  })
  .refine((v) => v.ids !== undefined || v.query !== undefined, {
    message: "memory_forget requires ids[] or query",
  });
export type MemoryForgetInput = z.infer<typeof memoryForgetInput>;

export const memoryConflictsInput = z.object({
  scope: z.string().min(1),
});
export type MemoryConflictsInput = z.infer<typeof memoryConflictsInput>;

export const memoryAuditInput = z.object({
  id: z.string().min(1),
});
export type MemoryAuditInput = z.infer<typeof memoryAuditInput>;

/** `format` is a placeholder enum; extend when export formats are decided. */
export const memoryExportInput = z.object({
  scope: z.string().min(1),
  format: z.enum(["json", "markdown"]),
});
export type MemoryExportInput = z.infer<typeof memoryExportInput>;

export const memoryAnswerInput = z.object({
  question: z.string().min(1),
  scope: z.string().min(1),
});
export type MemoryAnswerInput = z.infer<typeof memoryAnswerInput>;
