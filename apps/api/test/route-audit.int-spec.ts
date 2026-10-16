import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ModulesContainer } from '@nestjs/core';
import { closeApp, getApp } from './helpers';

const MARKERS = ['vcms:public', 'vcms:portal', 'vcms:authenticated', 'vcms:permissions', 'vcms:any-permissions'];

describe('Route security audit', () => {
  afterAll(closeApp);

  it('every route declares who may call it', async () => {
    const app = await getApp();
    const missing: string[] = [];
    let total = 0;
    for (const mod of app.get(ModulesContainer).values()) {
      for (const wrapper of mod.controllers.values()) {
        const cls = wrapper.metatype as any;
        if (!cls?.prototype) continue;
        const base = Reflect.getMetadata(PATH_METADATA, cls) ?? '';
        for (const name of Object.getOwnPropertyNames(cls.prototype)) {
          const handler = cls.prototype[name];
          if (name === 'constructor' || typeof handler !== 'function') continue;
          const path = Reflect.getMetadata(PATH_METADATA, handler);
          if (path === undefined) continue;
          total++;
          const declared = MARKERS.some((m) => Reflect.getMetadata(m, handler) !== undefined || Reflect.getMetadata(m, cls) !== undefined);
          if (!declared) missing.push(`${RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler)]} /${base}/${path} (${cls.name}.${name})`);
        }
      }
    }
    expect(total).toBeGreaterThan(300);
    expect(missing).toEqual([]);
  });
});
