/*
  Warnings:

  - Added the required column `twitterUsername` to the `tracking_rules` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "tracking_rules" ADD COLUMN "twitterUsername" TEXT;

-- 从用户表复制 Twitter 用户名到规则表
UPDATE "tracking_rules" r
SET "twitterUsername" = u."twitterUsername"
FROM "users" u
WHERE r."userId" = u."id";

-- 设置 twitterUsername 列为非空
ALTER TABLE "tracking_rules" ALTER COLUMN "twitterUsername" SET NOT NULL;
