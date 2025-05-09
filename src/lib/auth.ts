import { PrismaAdapter } from "@auth/prisma-adapter";
import { compare } from "bcryptjs";
import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { prisma } from "./prisma";
import { getServerSession } from "next-auth";

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  secret: process.env.NEXTAUTH_SECRET || "infotrack-default-secret-please-change-in-production",
  useSecureCookies: process.env.NODE_ENV === "production",
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" }
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          throw new Error("Invalid credentials");
        }

        const user = await prisma.user.findUnique({
          where: {
            email: credentials.email
          }
        });

        if (!user || !user.password) {
          throw new Error("User not found");
        }

        const isValid = await compare(credentials.password, user.password);

        if (!isValid) {
          throw new Error("Invalid password");
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
        };
      }
    })
  ],
  session: {
    strategy: "jwt"
  },
  pages: {
    signIn: "/auth/login",
  },
  callbacks: {
    async session({ session, token }) {
      if (token && session.user) {
        session.user.id = token.sub!;
      }
      return session;
    },
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
      }
      return token;
    }
  }
}; 

// 添加检查当前会话是否为管理员的函数
export async function isAdminSession(): Promise<boolean> {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return false;
    }
    
    // 获取用户信息
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { email: true }
    });
    
    // 根据电子邮件地址判断是否为管理员
    // 这里可以使用环境变量来指定管理员邮箱或一个邮箱列表
    const adminEmails = (process.env.ADMIN_EMAILS || 'admin@example.com').split(',');
    return user?.email ? adminEmails.includes(user.email) : false;
  } catch (error) {
    console.error('[Auth] 检查管理员权限失败:', error);
    return false;
  }
} 