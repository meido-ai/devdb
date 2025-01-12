import { z } from 'zod';
import type { components } from './api';

// Database schema
export const DatabaseSchema = z.object({
  name: z.string(),
  status: z.string(),
  project: z.string().optional(),
  host: z.string().optional(),
  port: z.number().optional(),
  username: z.string().optional(),
  database: z.string().optional(),
});

export type Database = components['schemas']['Database'];

// Project schema
export const ProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  backupLocation: z.string(),
  databases: z.array(DatabaseSchema).optional(),
});

export type Project = components['schemas']['Project'];

// Request body schemas
export const CreateDatabaseRequestSchema = z.object({
  name: z.string(),
  backupLocation: z.string().optional(),
  project: z.string().optional(),
}).refine(
  (data) => data.backupLocation !== undefined || data.project !== undefined,
  {
    message: 'Either backupLocation or project must be specified',
  }
);

export type CreateDatabaseRequest = z.infer<typeof CreateDatabaseRequestSchema>;
