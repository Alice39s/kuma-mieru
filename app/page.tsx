'use client';

import { apiConfig } from '@/config/api';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    // 获取默认页面ID，重定向到对应页面
    router.push(`/${apiConfig.defaultPageId}`);
  }, [router]);

  return null;
}
