-- CreateTable
CREATE TABLE "ProviderConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mode" TEXT NOT NULL DEFAULT 'mock',
    "updatedAt" DATETIME NOT NULL,
    "encryptedKey" TEXT,
    "keyHint" TEXT,
    "dailyCapUsd" REAL NOT NULL DEFAULT 5
);

-- CreateTable
CREATE TABLE "Agent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "systemPrompt" TEXT NOT NULL,
    "spriteSeed" INTEGER NOT NULL,
    "workDir" TEXT,
    "projectId" TEXT,
    "permission" TEXT NOT NULL DEFAULT 'ask',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" DATETIME
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agentId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "isMock" BOOLEAN NOT NULL DEFAULT false,
    "maxCostUsd" REAL NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" REAL,
    "steps" INTEGER NOT NULL DEFAULT 0,
    "output" TEXT,
    "error" TEXT,
    "failureKind" TEXT,
    "retryOf" TEXT,
    "pendingApproval" TEXT,
    "projectId" TEXT,
    "permission" TEXT NOT NULL DEFAULT 'ask',
    "continueOf" TEXT,
    "sessionId" TEXT,
    "sourceTaskId" TEXT,
    "exchangeKind" TEXT,
    "exchangeData" TEXT,
    "rootTaskId" TEXT,
    "exchangeDepth" INTEGER NOT NULL DEFAULT 0,
    "resultForTaskId" TEXT,
    "collaborationCancelled" BOOLEAN NOT NULL DEFAULT false,
    "threadTitle" TEXT,
    "threadPinnedAt" DATETIME,
    "threadArchivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    CONSTRAINT "Task_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TaskEvent" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "taskId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TaskEvent_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Note" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "content" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "Task_resultForTaskId_key" ON "Task"("resultForTaskId");

-- CreateIndex
CREATE INDEX "Task_agentId_status_idx" ON "Task"("agentId", "status");

-- CreateIndex
CREATE INDEX "Task_status_idx" ON "Task"("status");

-- CreateIndex
CREATE INDEX "Task_createdAt_idx" ON "Task"("createdAt");

-- CreateIndex
CREATE INDEX "Task_rootTaskId_idx" ON "Task"("rootTaskId");

-- CreateIndex
CREATE INDEX "Task_sourceTaskId_idx" ON "Task"("sourceTaskId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskEvent_taskId_seq_key" ON "TaskEvent"("taskId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "Project_path_key" ON "Project"("path");
