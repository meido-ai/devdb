import { z } from 'zod';
import { 
  Database, 
  Project, 
  CreateDatabaseRequest,
  DatabaseSchema,
  ProjectSchema,
  CreateDatabaseRequestSchema,
} from './schemas';

describe('API Types', () => {
  describe('DatabaseSchema', () => {
    it('should validate a valid database', () => {
      const validDatabase: Database = {
        name: 'test-db',
        status: 'running',
        host: 'localhost',
        port: 5432,
        username: 'postgres',
        database: 'test-db'
      };

      const result = DatabaseSchema.safeParse(validDatabase);
      expect(result.success).toBe(true);
    });

    it('should require name and status', () => {
      const invalidDatabase = {
        host: 'localhost',
        port: 5432
      };

      const result = DatabaseSchema.safeParse(invalidDatabase);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i: z.ZodIssue) => i.path.includes('name'))).toBe(true);
        expect(result.error.issues.some((i: z.ZodIssue) => i.path.includes('status'))).toBe(true);
      }
    });
  });

  describe('ProjectSchema', () => {
    it('should validate a valid project', () => {
      const validProject: Project = {
        id: 'proj-123',
        name: 'test-project',
        backupLocation: 's3://backup/test'
      };

      const result = ProjectSchema.safeParse(validProject);
      expect(result.success).toBe(true);
    });

    it('should require id, name, and backupLocation', () => {
      const invalidProject = {
        name: 'test-project'
      };

      const result = ProjectSchema.safeParse(invalidProject);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i: z.ZodIssue) => i.path.includes('id'))).toBe(true);
        expect(result.error.issues.some((i: z.ZodIssue) => i.path.includes('backupLocation'))).toBe(true);
      }
    });
  });

  describe('CreateDatabaseRequestSchema', () => {
    it('should validate request with backup location', () => {
      const validRequest: CreateDatabaseRequest = {
        name: 'test-db',
        backupLocation: 's3://backup/test.dump'
      };

      const result = CreateDatabaseRequestSchema.safeParse(validRequest);
      expect(result.success).toBe(true);
    });

    it('should validate request with project', () => {
      const validRequest: CreateDatabaseRequest = {
        name: 'test-db',
        project: 'test-project'
      };

      const result = CreateDatabaseRequestSchema.safeParse(validRequest);
      expect(result.success).toBe(true);
    });

    it('should require either backupLocation or project', () => {
      const invalidRequest = {
        name: 'test-db'
      };

      const result = CreateDatabaseRequestSchema.safeParse(invalidRequest);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('Either backupLocation or project must be specified');
      }
    });
  });
});
