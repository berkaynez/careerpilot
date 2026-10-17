import { jobSchema } from '../preparation/core.js';
import { z } from 'zod';

const {requirements, ...metadata} = jobSchema.shape;
/** Form preparation requires document-routing metadata, not invented qualification requirements. */
export const applicationTargetSchema = z.strictObject({...metadata, requirements:requirements.optional()}).superRefine((target,context)=>{
  if (target.requirements && new Set(target.requirements.map(item=>item.id)).size!==target.requirements.length)
    context.addIssue({code:'custom',message:'Duplicate requirements'});
});
export type ApplicationTarget = z.infer<typeof applicationTargetSchema>;
