import { Body, Controller, Get, Put, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { receiptSettingsSchema } from '@vcms/shared';
import type { Response } from 'express';
import { z } from 'zod';
import { RequireAnyPermission, RequirePermissions } from '../../common/auth/decorators';
import { ApiZodBody, zp } from '../../common/http/zod';
import { AttachmentsService } from '../attachments/attachments.service';
import { ReceiptSettingsService } from './receipt-settings.service';

/** Anyone who prints receipts (counter, payments, invoices) can read the layout; only settings managers change it. */
const READERS = ['pos.use', 'payments.take', 'billing.read', 'settings.manage'] as const;

@ApiTags('billing')
@Controller('receipt-settings')
export class ReceiptsController {
  constructor(
    private readonly receipts: ReceiptSettingsService,
    private readonly attachments: AttachmentsService,
  ) {}

  @Get()
  @RequireAnyPermission(...READERS)
  get() {
    return this.receipts.get();
  }

  @Put()
  @RequirePermissions('settings.manage')
  @ApiZodBody(receiptSettingsSchema)
  save(@Body(zp(receiptSettingsSchema)) body: z.infer<typeof receiptSettingsSchema>) {
    return this.receipts.save(body);
  }

  /** The logo printed on receipts: the receipt logo when one is chosen, otherwise the branding logo. */
  @Get('logo')
  @RequireAnyPermission(...READERS)
  async logo(@Res() res: Response) {
    const { meta, stream } = await this.attachments.open(await this.receipts.logoAttachmentId());
    res.setHeader('Content-Type', meta.mimeType);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    stream.pipe(res);
  }
}
