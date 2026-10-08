'use client';

import {
  AnimatePresence,
  motion,
  MotionValue,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
  type SpringOptions,
} from 'framer-motion';
import Link from 'next/link';
import {
  Children,
  cloneElement,
  createContext,
  isValidElement,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { cn } from '@/lib/utils';

/**
 * Apple-style dock: icons grow as the pointer passes over them and their name pops out.
 * From the component the owner picked, with two additions: a vertical dock (for the left side of
 * the screen) and items that are links (`href`), so pages open like any other link.
 */

const DOCK_HEIGHT = 128;
const DEFAULT_SIZE = 40;
const DEFAULT_MAGNIFICATION = 80;
const DEFAULT_DISTANCE = 150;
const DEFAULT_PANEL_HEIGHT = 64;

type Orientation = 'horizontal' | 'vertical';

type DockProps = {
  children: React.ReactNode;
  className?: string;
  distance?: number;
  panelHeight?: number;
  magnification?: number;
  /** Size of an icon tile at rest. */
  size?: number;
  orientation?: Orientation;
  spring?: SpringOptions;
  'aria-label'?: string;
};
type DockItemProps = {
  className?: string;
  children: React.ReactNode;
  /** Makes the item a link to this page. */
  href?: string;
  active?: boolean;
  onClick?: () => void;
  'aria-label'?: string;
};
type DockLabelProps = {
  className?: string;
  children: React.ReactNode;
};
type DockIconProps = {
  className?: string;
  children: React.ReactNode;
};

type DocContextType = {
  mouse: MotionValue<number>;
  spring: SpringOptions;
  magnification: number;
  distance: number;
  size: number;
  orientation: Orientation;
};
type DockProviderProps = {
  children: React.ReactNode;
  value: DocContextType;
};

const DockContext = createContext<DocContextType | undefined>(undefined);

const MotionLink = motion.create(Link);

function DockProvider({ children, value }: DockProviderProps) {
  return <DockContext.Provider value={value}>{children}</DockContext.Provider>;
}

function useDock() {
  const context = useContext(DockContext);
  if (!context) {
    throw new Error('useDock must be used within an DockProvider');
  }
  return context;
}

function Dock({
  children,
  className,
  spring = { mass: 0.1, stiffness: 150, damping: 12 },
  magnification = DEFAULT_MAGNIFICATION,
  distance = DEFAULT_DISTANCE,
  size = DEFAULT_SIZE,
  panelHeight = DEFAULT_PANEL_HEIGHT,
  orientation = 'horizontal',
  'aria-label': ariaLabel = 'Application dock',
}: DockProps) {
  const mouse = useMotionValue(Infinity);
  const isHovered = useMotionValue(0);
  // People who ask for less motion get the dock without the growing icons.
  const reduced = useReducedMotion();
  const grow = reduced ? size : magnification;
  const vertical = orientation === 'vertical';

  const maxHeight = useMemo(() => {
    return Math.max(DOCK_HEIGHT, grow + grow / 2 + 4);
  }, [grow]);

  const heightRow = useTransform(isHovered, [0, 1], [panelHeight, maxHeight]);
  const height = useSpring(heightRow, spring);

  const context = useMemo(
    () => ({ mouse, spring, distance, magnification: grow, size, orientation }),
    [mouse, spring, distance, grow, size, orientation]
  );

  const panel = (
    <motion.div
      onMouseMove={({ clientX, clientY }) => {
        isHovered.set(1);
        mouse.set(vertical ? clientY : clientX);
      }}
      onMouseLeave={() => {
        isHovered.set(0);
        mouse.set(Infinity);
      }}
      className={cn(
        vertical
          ? 'flex h-fit flex-col items-start gap-4 rounded-2xl bg-gray-50 py-4'
          : 'mx-auto flex w-fit gap-4 rounded-2xl bg-gray-50 px-4 dark:bg-neutral-900',
        className
      )}
      style={vertical ? { width: panelHeight } : { height: panelHeight }}
      role='toolbar'
      aria-orientation={orientation}
      aria-label={ariaLabel}
    >
      <DockProvider value={context}>{children}</DockProvider>
    </motion.div>
  );

  // A vertical dock sits in a side column: its icons grow out over the page instead of widening it.
  if (vertical) return panel;

  return (
    <motion.div
      style={{
        height: height,
        scrollbarWidth: 'none',
      }}
      className='mx-2 flex max-w-full items-end overflow-x-auto'
    >
      {panel}
    </motion.div>
  );
}

function DockItem({ children, className, href, active, onClick, 'aria-label': ariaLabel }: DockItemProps) {
  const ref = useRef<HTMLElement>(null);

  const { distance, magnification, mouse, spring, size, orientation } = useDock();

  const isHovered = useMotionValue(0);

  const mouseDistance = useTransform(mouse, (val) => {
    const domRect = ref.current?.getBoundingClientRect() ?? { x: 0, y: 0, width: 0, height: 0 };
    return orientation === 'vertical'
      ? val - domRect.y - domRect.height / 2
      : val - domRect.x - domRect.width / 2;
  });

  const widthTransform = useTransform(
    mouseDistance,
    [-distance, 0, distance],
    [size, magnification, size]
  );

  const width = useSpring(widthTransform, spring);

  const shared = {
    style: { width },
    onHoverStart: () => isHovered.set(1),
    onHoverEnd: () => isHovered.set(0),
    onFocus: () => isHovered.set(1),
    onBlur: () => isHovered.set(0),
    className: cn('relative inline-flex shrink-0 items-center justify-center', className),
  };
  // DockLabel and DockIcon read these; anything else (a plain element, nothing) passes through untouched.
  const content = Children.map(children, (child) =>
    isValidElement(child) && typeof child.type !== 'string'
      ? cloneElement(child as React.ReactElement<Record<string, unknown>>, { width, isHovered })
      : child
  );

  if (href) {
    return (
      <MotionLink
        ref={ref as React.Ref<HTMLAnchorElement>}
        href={href}
        onClick={onClick}
        aria-label={ariaLabel}
        aria-current={active ? 'page' : undefined}
        {...shared}
      >
        {content}
      </MotionLink>
    );
  }

  return (
    <motion.div
      ref={ref as React.Ref<HTMLDivElement>}
      onClick={onClick}
      tabIndex={0}
      role='button'
      aria-haspopup='true'
      aria-label={ariaLabel}
      {...shared}
    >
      {content}
    </motion.div>
  );
}

function DockLabel({ children, className, ...rest }: DockLabelProps) {
  const restProps = rest as Record<string, unknown>;
  const isHovered = restProps['isHovered'] as MotionValue<number>;
  const [isVisible, setIsVisible] = useState(false);
  const { orientation } = useDock();
  const vertical = orientation === 'vertical';

  useEffect(() => {
    const unsubscribe = isHovered.on('change', (latest) => {
      setIsVisible(latest === 1);
    });

    return () => unsubscribe();
  }, [isHovered]);

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={vertical ? { opacity: 0, x: 0 } : { opacity: 0, y: 0 }}
          animate={vertical ? { opacity: 1, x: 10 } : { opacity: 1, y: -10 }}
          exit={vertical ? { opacity: 0, x: 0 } : { opacity: 0, y: 0 }}
          transition={{ duration: 0.2 }}
          className={cn(
            'pointer-events-none absolute w-fit whitespace-pre rounded-md border border-gray-200 bg-gray-100 px-2 py-0.5 text-xs text-neutral-700 dark:border-neutral-900 dark:bg-neutral-800 dark:text-white',
            vertical ? 'left-full top-1/2' : '-top-6 left-1/2',
            className
          )}
          role='tooltip'
          style={vertical ? { y: '-50%' } : { x: '-50%' }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function DockIcon({ children, className, ...rest }: DockIconProps) {
  const restProps = rest as Record<string, unknown>;
  const width = restProps['width'] as MotionValue<number>;

  const widthTransform = useTransform(width, (val) => val / 2);

  return (
    <motion.div
      style={{ width: widthTransform }}
      className={cn('flex items-center justify-center', className)}
    >
      {children}
    </motion.div>
  );
}

export { Dock, DockIcon, DockItem, DockLabel };
