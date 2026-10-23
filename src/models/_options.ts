import type { Schema } from 'mongoose';

/** Every model serialises `_id` as `id` and never leaks internal fields. */
export function withJson<T extends Schema>(schema: T): T {
  schema.set('toJSON', {
    virtuals: true,
    versionKey: false,
    transform: (_doc: unknown, ret: Record<string, unknown>) => {
      ret.id = String(ret._id);
      delete ret._id;
      delete ret.passwordHash;
      return ret;
    },
  });
  return schema;
}
