-- Approvals answered "Always allow", per project.
ALTER TABLE "Project" ADD COLUMN "allowedActions" TEXT NOT NULL DEFAULT '[]';
