-- AlterTable
ALTER TABLE "CareItem" ADD COLUMN     "productId" UUID;

-- AddForeignKey
ALTER TABLE "CareItem" ADD CONSTRAINT "CareItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
