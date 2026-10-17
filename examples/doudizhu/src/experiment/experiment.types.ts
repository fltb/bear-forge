import type { z } from 'zod';
import type { RegistrationSchema } from './registration.schemas.ts';

export type Registration = z.infer<typeof RegistrationSchema>;
export type Task = { id: string; seed: number; seats: Registration['seats'] };
