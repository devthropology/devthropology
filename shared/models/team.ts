import { z } from "zod";

export const TeamSourceTypeSchema = z.enum(["manual", "github"]);
export type TeamSourceType = z.infer<typeof TeamSourceTypeSchema>;

export const TeamSchema = z.object({
  teamId: z.coerce.number(),
  repositoryId: z.coerce.number(),
  name: z.string(),
  slug: z.string(),
  sourceType: TeamSourceTypeSchema,
  ghTeamId: z.coerce.number().nullable(),
  ghOrgLogin: z.string().nullable(),
  memberCount: z.coerce.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Team = z.infer<typeof TeamSchema>;

export const TeamMemberRoleSchema = z.enum(["member", "maintainer"]);
export type TeamMemberRole = z.infer<typeof TeamMemberRoleSchema>;

export const TeamMemberSchema = z.object({
  teamMemberId: z.coerce.number(),
  teamId: z.coerce.number(),
  userId: z.coerce.number(),
  ghLogin: z.string(),
  memberRole: TeamMemberRoleSchema.nullable(),
  sourceType: TeamSourceTypeSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type TeamMember = z.infer<typeof TeamMemberSchema>;

export const TeamAvailableUserSchema = z.object({
  userId: z.coerce.number(),
  ghLogin: z.string(),
});
export type TeamAvailableUser = z.infer<typeof TeamAvailableUserSchema>;

export const CreateTeamRequestSchema = z.object({
  name: z.string().trim().min(1),
  userIds: z.array(z.coerce.number().int().positive()).default([]),
});
export type CreateTeamRequest = z.infer<typeof CreateTeamRequestSchema>;

export const UpdateTeamRequestSchema = z.object({
  name: z.string().trim().min(1),
});
export type UpdateTeamRequest = z.infer<typeof UpdateTeamRequestSchema>;

export const ReplaceTeamMembersRequestSchema = z.object({
  userIds: z.array(z.coerce.number().int().positive()),
});
export type ReplaceTeamMembersRequest = z.infer<
  typeof ReplaceTeamMembersRequestSchema
>;
