/**
 * Domain layer — public surface.
 *
 * Row shapes mirror `SCHEMA.sql` (applied as migration 0001) plus migrations
 * 0004 (deal rooms) and 0005 (operations). The deterministic logic that belongs
 * with each shape lives beside it: thread visibility with deal types, criteria
 * evaluation with saved searches, Schedule E rollup with expenses.
 *
 * Nothing here performs I/O. The read layer assembles these shapes; this layer
 * only describes and computes over them.
 */

export * from "./enums";
export * from "./provenance";
export * from "./property";
export * from "./deals";
export * from "./saved-search";
export * from "./documents";
export * from "./applications";
export * from "./expenses";
export * from "./pros";
