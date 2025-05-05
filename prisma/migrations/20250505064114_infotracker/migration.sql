-- DropForeignKey
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_tweetId_fkey";

-- DropForeignKey
ALTER TABLE "tracking_rules" DROP CONSTRAINT "tracking_rules_userId_fkey";

-- DropForeignKey
ALTER TABLE "tweet_analyses" DROP CONSTRAINT "tweet_analyses_tweetId_fkey";

-- DropForeignKey
ALTER TABLE "tweets" DROP CONSTRAINT "tweets_matchedRuleId_fkey";

-- AddForeignKey
ALTER TABLE "tracking_rules" ADD CONSTRAINT "tracking_rules_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tweets" ADD CONSTRAINT "tweets_matchedRuleId_fkey" FOREIGN KEY ("matchedRuleId") REFERENCES "tracking_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tweet_analyses" ADD CONSTRAINT "tweet_analyses_tweetId_fkey" FOREIGN KEY ("tweetId") REFERENCES "tweets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tweetId_fkey" FOREIGN KEY ("tweetId") REFERENCES "tweets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
