'use client';

import { signOut, useSession } from 'next-auth/react';
import Link from 'next/link';
import { Fragment } from 'react';
import { Menu, Transition } from '@headlessui/react';

export function UserNav() {
  const { data: session } = useSession();

  if (!session) {
    return (
      <div className="flex items-center space-x-4">
        <Link
          href="/auth/login"
          className="text-gray-500 hover:text-gray-700 text-sm font-medium"
        >
          登录
        </Link>
        <Link
          href="/auth/register"
          className="bg-blue-600 text-white hover:bg-blue-700 px-4 py-2 rounded-md text-sm font-medium"
        >
          注册
        </Link>
      </div>
    );
  }

  return (
    <Menu as="div" className="relative ml-3">
      <div>
        <Menu.Button className="flex rounded-full bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2">
          <span className="sr-only">打开用户菜单</span>
          {session.user?.image ? (
            <img
              className="h-8 w-8 rounded-full"
              src={session.user.image}
              alt={session.user.name || '用户头像'}
            />
          ) : (
            <div className="h-8 w-8 rounded-full bg-blue-500 flex items-center justify-center text-white">
              {(session.user?.name || session.user?.email || '?')[0].toUpperCase()}
            </div>
          )}
        </Menu.Button>
      </div>
      <Transition
        as={Fragment}
        enter="transition ease-out duration-200"
        enterFrom="transform opacity-0 scale-95"
        enterTo="transform opacity-100 scale-100"
        leave="transition ease-in duration-75"
        leaveFrom="transform opacity-100 scale-100"
        leaveTo="transform opacity-0 scale-95"
      >
        <Menu.Items className="absolute right-0 z-10 mt-2 w-48 origin-top-right rounded-md bg-white py-1 shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none">
          <div className="px-4 py-2 text-sm text-gray-900 border-b">
            <div className="font-medium">{session.user?.name}</div>
            <div className="text-gray-500">{session.user?.email}</div>
          </div>
          <Menu.Item>
            {({ active }) => (
              <Link
                href="/profile"
                className={`block px-4 py-2 text-sm ${
                  active ? 'bg-gray-100' : ''
                } text-gray-700`}
              >
                个人资料
              </Link>
            )}
          </Menu.Item>
          <Menu.Item>
            {({ active }) => (
              <button
                onClick={() => signOut()}
                className={`block w-full text-left px-4 py-2 text-sm ${
                  active ? 'bg-gray-100' : ''
                } text-gray-700`}
              >
                退出登录
              </button>
            )}
          </Menu.Item>
        </Menu.Items>
      </Transition>
    </Menu>
  );
} 