import { Card as HeroUICard, Skeleton as HeroUISkeleton } from '@heroui/react';

export const AlertSkeleton = () => {
  return (
    <HeroUICard className="w-full p-4">
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <HeroUISkeleton className="h-4 w-1/4 rounded-lg mb-2" />
          <HeroUISkeleton className="h-3 w-3/4 rounded-lg" />
        </div>
        <HeroUISkeleton className="h-8 w-8 rounded-full" />
      </div>
    </HeroUICard>
  );
};
