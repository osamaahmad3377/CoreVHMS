import { DEFAULT_PRODUCT_CATEGORIES } from '@vcms/shared';
import { closeApp, prisma, registerOrg, staff } from './helpers';

const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082',
  'hex',
);

// Prices are arbitrary test values.
describe('Shop products: food, grooming, accessories', () => {
  afterAll(closeApp);

  it('gives new clinics starter categories and keeps shop items out of prescription rules', async () => {
    const org = await registerOrg();
    const cats = (await org.owner.get('/product-categories')).body as any[];
    expect(cats.map((c) => c.name).sort()).toEqual(DEFAULT_PRODUCT_CATEGORIES.map((c) => c.name).sort());
    const dry = cats.find((c) => c.name === 'Dry food');
    const shampoo = cats.find((c) => c.name === 'Shampoos & conditioners');
    expect(dry).toMatchObject({ productType: 'FOOD', productCount: 0 });

    // A food product can never be prescription-only or controlled, whatever is sent.
    const food = await org.owner.post('/products', {
      name: 'Adult dog kibble chicken', type: 'FOOD', categoryId: dry.id, brand: 'DemoBrand', packSize: '3 kg bag', dispensingUnit: 'bag',
      minDispenseIncrement: 1, sellPriceMinor: 450000, requiresPrescription: true, isControlled: true, controlledSchedule: 'S8',
    });
    expect(food.status).toBe(201);
    expect(food.body).toMatchObject({ type: 'FOOD', categoryId: dry.id, brand: 'DemoBrand', packSize: '3 kg bag', requiresPrescription: false, isControlled: false, controlledSchedule: null });
    expect((await org.owner.get(`/products/${food.body.id}`)).body.productCategory).toEqual({ id: dry.id, name: 'Dry food' });

    // Categories belong to a type and to the clinic.
    const wrong = await org.owner.post('/products', { name: 'Kibble in shampoo shelf', type: 'FOOD', categoryId: shampoo.id, dispensingUnit: 'bag', minDispenseIncrement: 1 });
    expect(wrong.body.error.code).toBe('CATEGORY_TYPE_MISMATCH');
    expect((await org.owner.patch(`/products/${food.body.id}`, { type: 'MEDICINE' })).body.error.code).toBe('CATEGORY_TYPE_MISMATCH');
    const other = await registerOrg();
    const theirs = ((await other.owner.get('/product-categories')).body as any[])[0];
    expect((await org.owner.post('/products', { name: 'Stolen shelf', type: theirs.productType, categoryId: theirs.id, dispensingUnit: 'piece', minDispenseIncrement: 1 })).body.error.code).toBe('INVALID_CATEGORY');

    // Medicines keep their rules.
    const med = (await org.owner.post('/products', { name: 'Testacillin 50 mg', type: 'MEDICINE', strengthValue: 50, strengthUnit: 'mg', dispensingUnit: 'tablet', minDispenseIncrement: 1, requiresPrescription: true, sellPriceMinor: 100 })).body;
    expect(med.requiresPrescription).toBe(true);

    // Lists: shop vs clinical, by category, and search by brand.
    const shop = (await org.owner.get('/products?kind=shop')).body.data.map((p: any) => p.id);
    expect(shop).toContain(food.body.id);
    expect(shop).not.toContain(med.id);
    expect((await org.owner.get('/products?kind=clinical')).body.data.map((p: any) => p.id)).toEqual([med.id]);
    expect((await org.owner.get(`/products?categoryId=${dry.id}`)).body.data.map((p: any) => p.id)).toEqual([food.body.id]);
    expect((await org.owner.get('/products?q=demobrand')).body.data.map((p: any) => p.id)).toEqual([food.body.id]);
    expect(((await org.owner.get('/product-categories')).body as any[]).find((c) => c.id === dry.id).productCount).toBe(1);
  });

  it('manages categories: custom ones, unique names, hiding, and type changes only when safe', async () => {
    const org = await registerOrg();
    const c = await org.owner.post('/product-categories', { name: 'Horse tack', productType: 'ACCESSORY', sortOrder: 60 });
    expect(c.status).toBe(201);
    expect((await org.owner.post('/product-categories', { name: 'horse TACK', productType: 'ACCESSORY' })).status).toBe(409);
    const p = (await org.owner.post('/products', { name: 'Lead rope', type: 'ACCESSORY', categoryId: c.body.id, dispensingUnit: 'piece', minDispenseIncrement: 1, sellPriceMinor: 2000 })).body;
    expect((await org.owner.patch(`/product-categories/${c.body.id}`, { productType: 'FOOD' })).body.error.code).toBe('CATEGORY_IN_USE');
    expect((await org.owner.patch(`/product-categories/${c.body.id}`, { name: 'Horse tack & rugs' })).body.name).toBe('Horse tack & rugs');
    expect((await org.owner.patch(`/product-categories/${c.body.id}`, { isActive: false })).body.isActive).toBe(false);
    expect(((await org.owner.get('/product-categories')).body as any[]).some((x) => x.id === c.body.id)).toBe(false);
    expect(((await org.owner.get('/product-categories?all=true')).body as any[]).some((x) => x.id === c.body.id)).toBe(true);
    // A hidden category cannot be given to more products; products already in it keep it.
    expect((await org.owner.post('/products', { name: 'Hoof pick', type: 'ACCESSORY', categoryId: c.body.id, dispensingUnit: 'piece', minDispenseIncrement: 1 })).body.error.code).toBe('INVALID_CATEGORY');
    expect((await org.owner.patch(`/products/${p.id}`, { sellPriceMinor: 2500 })).status).toBe(200);
    // Audit and permissions.
    expect(await prisma().auditEvent.count({ where: { organizationId: org.orgId, action: { startsWith: 'product_category.' } } })).toBe(3); // created, renamed, hidden (the refused change writes nothing)
    const rec = await staff(org, 'receptionist');
    expect((await rec.client.get('/product-categories')).status).toBe(200);
    expect((await rec.client.post('/product-categories', { name: 'Nope' })).status).toBe(403);
  });

  it('sells shop items at the counter with category filters, photos and sales by category', async () => {
    const org = await registerOrg();
    const cats = (await org.owner.get('/product-categories')).body as any[];
    const wet = cats.find((c) => c.name === 'Wet food');
    const toys = cats.find((c) => c.name === 'Toys');
    const can = (await org.owner.post('/products', { name: 'Cat pate salmon', type: 'FOOD', categoryId: wet.id, brand: 'Purrfect', packSize: '85 g pouch', barcode: '5000000000011', dispensingUnit: 'pouch', minDispenseIncrement: 1, sellPriceMinor: 30000 })).body;
    const ball = (await org.owner.post('/products', { name: 'Rubber ball', type: 'ACCESSORY', categoryId: toys.id, dispensingUnit: 'piece', minDispenseIncrement: 1, sellPriceMinor: 50000 })).body;

    // Photo: an image attached to this product.
    const up = await org.owner.upload('/attachments', { entityType: 'Product', entityId: can.id, category: 'photo' }, { buffer: PNG, name: 'pouch.png', type: 'image/png' });
    expect(up.status).toBe(201);
    expect((await org.owner.post(`/products/${ball.id}/photo`, { attachmentId: up.body.id })).body.error.code).toBe('INVALID_PHOTO');
    expect((await org.owner.post(`/products/${can.id}/photo`, { attachmentId: up.body.id })).status).toBe(200);

    const food = (await org.owner.get('/pos/catalog?category=FOOD')).body.items;
    expect(food).toEqual([expect.objectContaining({ id: can.id, category: 'FOOD', categoryName: 'Wet food', brand: 'Purrfect', packSize: '85 g pouch', photoAttachmentId: up.body.id, rxOnly: false })]);
    const inToys = (await org.owner.get(`/pos/catalog?categoryId=${toys.id}`)).body.items;
    expect(inToys.map((i: any) => i.id)).toEqual([ball.id]); // a category filter shows no services
    expect((await org.owner.get('/pos/catalog?q=purrfect')).body.items.map((i: any) => i.id)).toEqual([can.id]);
    expect((await org.owner.get('/pos/catalog?q=5000000000011')).body.exact).toMatchObject({ id: can.id });
    // Someone at the counter (no stock rights) can see the photo.
    const rec = await staff(org, 'receptionist');
    expect((await rec.client.get(`/attachments/${up.body.id}/download`)).status).toBe(200);

    const sale = await org.owner.post('/invoices', { isPos: true, lines: [{ kind: 'PRODUCT', productId: can.id, quantity: 3 }, { kind: 'PRODUCT', productId: ball.id, quantity: 1 }], issue: true });
    expect(sale.status).toBe(201);
    const from = new Date(Date.now() - 86_400_000).toISOString();
    const to = new Date(Date.now() + 86_400_000).toISOString();
    const report = (await org.owner.get(`/reports/sales-by-category?from=${from}&to=${to}`)).body;
    expect(report.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ group: 'Food & treats › Wet food', lines: 1, quantity: 3 }),
        expect.objectContaining({ group: 'Accessories › Toys', lines: 1, quantity: 1 }),
      ]),
    );
    expect(report.totalMinor).toBe(report.rows.reduce((n: number, r: any) => n + r.netMinor, 0));
  });
});
