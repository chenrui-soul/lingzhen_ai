import { describe, expect, it } from 'vitest';

import { createLingzhenApp } from '@/app/create-app';

describe('createLingzhenApp', () => {
  it('registers the interactive billing components used by the Sandbox modal', () => {
    const app = createLingzhenApp();
    const components = app._context.components;

    expect(components.AModal).toBeDefined();
    expect(components.ARadioGroup).toBeDefined();
    expect(components.ARadioButton).toBeDefined();
    expect(components.AInputNumber).toBeDefined();
  });
});
