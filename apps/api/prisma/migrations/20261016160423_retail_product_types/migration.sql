-- New product types for the shop (separate migration: new enum values cannot be used in the same transaction).
ALTER TYPE "ProductType" ADD VALUE IF NOT EXISTS 'SUPPLEMENT';
ALTER TYPE "ProductType" ADD VALUE IF NOT EXISTS 'GROOMING';
ALTER TYPE "ProductType" ADD VALUE IF NOT EXISTS 'ACCESSORY';
