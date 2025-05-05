-- AlterTable
ALTER TABLE "tracking_rules" ADD COLUMN     "llmApiKey" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "llmProvider" TEXT NOT NULL DEFAULT 'openai';
