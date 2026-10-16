-- Shop categories, brand, pack size and photo for products.
CREATE TABLE "ProductCategory" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "productType" "ProductType",
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "ProductCategory_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProductCategory_organizationId_productType_sortOrder_idx" ON "ProductCategory"("organizationId", "productType", "sortOrder");
CREATE UNIQUE INDEX "ProductCategory_organizationId_name_key" ON "ProductCategory"("organizationId", "name");
ALTER TABLE "ProductCategory" ADD CONSTRAINT "ProductCategory_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductCategory" ADD CONSTRAINT product_category_name_not_blank CHECK (length(btrim(name)) > 0);

ALTER TABLE "Product" ADD COLUMN "brand" TEXT, ADD COLUMN "categoryId" UUID, ADD COLUMN "packSize" TEXT, ADD COLUMN "photoAttachmentId" UUID;
CREATE INDEX "Product_organizationId_categoryId_idx" ON "Product"("organizationId", "categoryId");
ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ProductCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Keep any free-text categories already typed on products: each becomes a category and the product is linked to it.
INSERT INTO "ProductCategory" (id, "organizationId", name, "updatedAt")
SELECT gen_random_uuid(), p."organizationId", btrim(p.category), now()
FROM "Product" p WHERE p.category IS NOT NULL AND btrim(p.category) <> ''
GROUP BY p."organizationId", btrim(p.category)
ON CONFLICT ("organizationId", name) DO NOTHING;
UPDATE "Product" p SET "categoryId" = c.id
FROM "ProductCategory" c
WHERE c."organizationId" = p."organizationId" AND c.name = btrim(p.category);
ALTER TABLE "Product" DROP COLUMN "category";

-- Starter shelf categories for every existing organization (editable; new organizations get the same set on creation).
INSERT INTO "ProductCategory" (id, "organizationId", name, "productType", "sortOrder", "updatedAt")
SELECT gen_random_uuid(), o.id, d.name, d.type::"ProductType", d.sort, now()
FROM "Organization" o
CROSS JOIN (VALUES
  ('Dry food', 'FOOD', 10), ('Wet food', 'FOOD', 20), ('Veterinary diets', 'FOOD', 30), ('Treats & chews', 'FOOD', 40), ('Livestock feed & minerals', 'FOOD', 50),
  ('Shampoos & conditioners', 'GROOMING', 10), ('Brushes, combs & clippers', 'GROOMING', 20), ('Ear, eye & dental care', 'GROOMING', 30), ('Litter & hygiene', 'GROOMING', 40),
  ('Collars, leads & harnesses', 'ACCESSORY', 10), ('Toys', 'ACCESSORY', 20), ('Beds, crates & carriers', 'ACCESSORY', 30), ('Bowls & feeders', 'ACCESSORY', 40), ('Clothing & recovery wear', 'ACCESSORY', 50),
  ('Vitamins & supplements', 'SUPPLEMENT', 10)
) AS d(name, type, sort)
ON CONFLICT ("organizationId", name) DO NOTHING;
