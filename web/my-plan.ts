import { useState } from 'react';
import type { MyPlan } from '../shared/course-directory';

const storageKey = 'csu-my-plan';

export function readMyPlan(storage?: Pick<Storage, 'getItem'>): MyPlan | null {
  try {
    const raw = (storage ?? localStorage).getItem(storageKey);
    if (!raw || raw.length > 2048) return null;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const { college, program } = value as Record<string, unknown>;
    if (typeof college !== 'string' || typeof program !== 'string' ||
      college.length > 100 || program.length > 100 || /\0/.test(college + program)) return null;
    return college.trim() || program.trim() ? { college: college.trim(), program: program.trim() } : null;
  } catch {
    return null;
  }
}

export function writeMyPlan(plan: MyPlan | null, storage?: Pick<Storage, 'setItem' | 'removeItem'>) {
  try {
    const target = storage ?? localStorage;
    if (plan) target.setItem(storageKey, JSON.stringify({ college: plan.college, program: plan.program }));
    else target.removeItem(storageKey);
    return true;
  } catch {
    return false;
  }
}

export function useMyPlan() {
  const [myPlan, setMyPlan] = useState(() => readMyPlan());
  const [planStored, setPlanStored] = useState(true);
  function rememberPlan(plan: MyPlan | null) {
    setMyPlan(plan);
    setPlanStored(writeMyPlan(plan));
  }
  return { myPlan, planStored, rememberPlan };
}
