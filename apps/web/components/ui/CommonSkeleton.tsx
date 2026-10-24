'use client';

import { CardBody, CardHeader, Card as HeroUICard } from '@heroui/react';
import { Navbar as HeroUINavbar, NavbarBrand, NavbarContent, NavbarItem } from '@heroui/react';
import { Skeleton as HeroUISkeleton } from '@heroui/react';

export const NavbarSkeleton = () => {
  return (
    <HeroUINavbar maxWidth="xl" position="sticky">
      <NavbarContent className="basis-1/5 sm:basis-full" justify="start">
        <NavbarBrand as="li" className="gap-3 max-w-fit">
          <div className="flex justify-start items-center gap-2">
            <HeroUISkeleton className="flex rounded-full w-8 h-8" />
            <HeroUISkeleton className="h-3 w-24 rounded-lg" />
          </div>
        </NavbarBrand>
      </NavbarContent>

      <NavbarContent className="hidden sm:flex basis-1/5 sm:basis-full" justify="end">
        <NavbarItem className="hidden sm:flex gap-2">
          <HeroUISkeleton className="flex rounded-full w-8 h-8" />
        </NavbarItem>
        <NavbarItem className="hidden lg:flex">
          <HeroUISkeleton className="h-10 w-[200px] rounded-lg" />
        </NavbarItem>
        <NavbarItem className="hidden md:flex">
          <HeroUISkeleton className="h-10 w-[140px] rounded-lg" />
        </NavbarItem>
      </NavbarContent>

      <NavbarContent className="sm:hidden basis-1 pl-4" justify="end">
        <HeroUISkeleton className="flex rounded-full w-8 h-8" />
        <HeroUISkeleton className="flex rounded-full w-8 h-8" />
        <HeroUISkeleton className="flex rounded-full w-8 h-8" />
      </NavbarContent>
    </HeroUINavbar>
  );
};

export const MonitorCardSkeleton = () => {
  return (
    <HeroUICard className="w-full">
      <CardHeader className="flex justify-between items-center">
        {/* 标题 */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <HeroUISkeleton className="h-6 w-6 rounded-full" />
            <HeroUISkeleton className="h-6 w-32 rounded-lg" />
          </div>
          {/* 标签 */}
          <div className="flex flex-wrap gap-2">
            <HeroUISkeleton className="h-5 w-12 rounded-lg" />
            <HeroUISkeleton className="h-5 w-12 rounded-lg" />
            <HeroUISkeleton className="h-5 w-12 rounded-lg" />
          </div>
        </div>
        <div className="inline-flex items-center gap-2">
          <HeroUISkeleton className="h-10 w-10 rounded-full" />
          <HeroUISkeleton className="h-4 w-16 rounded-lg" />
        </div>
      </CardHeader>
      <CardBody>
        <div className="space-y-4">
          {/* Block Indicator */}
          <div className="flex gap-1">
            <HeroUISkeleton className="h-8 w-full rounded-sm" />
          </div>
          <HeroUISkeleton className="h-px w-full" />
          {/* Charts */}
          <HeroUISkeleton className="h-[120px] w-full rounded-lg" />
        </div>
      </CardBody>
    </HeroUICard>
  );
};
