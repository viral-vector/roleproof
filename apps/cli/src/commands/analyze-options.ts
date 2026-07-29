import { z } from 'zod';

export const AnalyzeOptionsSchema = z
  .object({
    resume: z.string().min(1),
    job: z.string().min(1),
    format: z.enum(['json', 'markdown', 'both']),
    out: z.string().min(1).optional(),
    stdout: z.boolean(),
    ai: z.boolean(),
    store: z.boolean(),
    profile: z.string().min(1).optional(),
    targetSalaryMin: z.coerce.number().finite().nonnegative().optional(),
    targetSalaryMax: z.coerce.number().finite().nonnegative().optional(),
    location: z.string().min(1).optional(),
    remotePreference: z.enum(['remote', 'hybrid', 'onsite', 'any']).optional(),
  })
  .strict()
  .superRefine((options, context) => {
    if (
      options.targetSalaryMin !== undefined &&
      options.targetSalaryMax !== undefined &&
      options.targetSalaryMin > options.targetSalaryMax
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Target salary minimum must not exceed the maximum',
        path: ['targetSalaryMin'],
      });
    }
    if (options.format === 'both' && options.stdout) {
      context.addIssue({
        code: 'custom',
        message: 'JSON and Markdown cannot be written together to stdout',
        path: ['stdout'],
      });
    }
  });

export type AnalyzeOptions = z.infer<typeof AnalyzeOptionsSchema>;
