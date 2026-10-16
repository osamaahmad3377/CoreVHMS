import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  addressSchema,
  archiveSchema,
  clientContactSchema,
  clientListQuery,
  clientNoteSchema,
  createClientSchema,
  duplicateCheckSchema,
  mergeClientsSchema,
  updateClientSchema,
} from '@vcms/shared';
import type { Response } from 'express';
import { z } from 'zod';
import { RequirePermissions } from '../../common/auth/decorators';
import { ApiZodBody, ApiZodQuery, zp } from '../../common/http/zod';
import { ClientPrivacyService } from './client-privacy.service';
import { ClientsService } from './clients.service';

const UUID = new ParseUUIDPipe();
const anonymiseSchema = z.object({ reason: z.string().trim().min(3).max(500) });

@ApiTags('clients')
@Controller('clients')
export class ClientsController {
  constructor(
    private readonly clients: ClientsService,
    private readonly privacy: ClientPrivacyService,
  ) {}

  /** Everything held about one client, as a JSON download (data-subject access request). */
  @Get(':id/data-export')
  @RequirePermissions('privacy.manage')
  async dataExport(@Param('id', UUID) id: string, @Res() res: Response) {
    const data = await this.privacy.export(id);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="client-${data.client.number}-export-${new Date().toISOString().slice(0, 10)}.json"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(JSON.stringify(data, null, 2));
  }

  /** Removes the client's personal details on request; clinical and financial records are retained. */
  @Post(':id/anonymise')
  @HttpCode(200)
  @RequirePermissions('privacy.manage')
  anonymise(@Param('id', UUID) id: string, @Body(zp(anonymiseSchema)) body: { reason: string }) {
    return this.privacy.anonymise(id, body.reason);
  }

  @Get()
  @RequirePermissions('clients.read')
  @ApiZodQuery(clientListQuery)
  list(@Query(zp(clientListQuery)) q: z.infer<typeof clientListQuery>) {
    return this.clients.list(q);
  }

  @Get('export.csv')
  @RequirePermissions('clients.export')
  async export(@Query(zp(clientListQuery)) q: z.infer<typeof clientListQuery>, @Res() res: Response) {
    const csv = await this.clients.exportCsv(q);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="clients-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(csv);
  }

  @Post('duplicates')
  @HttpCode(200)
  @RequirePermissions('clients.read')
  @ApiZodBody(duplicateCheckSchema)
  duplicates(@Body(zp(duplicateCheckSchema)) body: z.infer<typeof duplicateCheckSchema>) {
    return this.clients.findDuplicates(body);
  }

  @Post('merge')
  @HttpCode(200)
  @RequirePermissions('clients.merge')
  @ApiZodBody(mergeClientsSchema)
  merge(@Body(zp(mergeClientsSchema)) body: z.infer<typeof mergeClientsSchema>) {
    return this.clients.merge(body.survivorId, body.mergedId, body.reason);
  }

  @Get(':id')
  @RequirePermissions('clients.read')
  get(@Param('id', UUID) id: string) {
    return this.clients.get(id);
  }

  @Post()
  @RequirePermissions('clients.write')
  @ApiZodBody(createClientSchema)
  create(@Body(zp(createClientSchema)) body: z.infer<typeof createClientSchema>) {
    return this.clients.create(body);
  }

  @Patch(':id')
  @RequirePermissions('clients.write')
  @ApiZodBody(updateClientSchema)
  update(@Param('id', UUID) id: string, @Body(zp(updateClientSchema)) body: z.infer<typeof updateClientSchema>) {
    return this.clients.update(id, body);
  }

  @Post(':id/archive')
  @HttpCode(200)
  @RequirePermissions('clients.archive')
  @ApiZodBody(archiveSchema)
  archive(@Param('id', UUID) id: string, @Body(zp(archiveSchema)) body: z.infer<typeof archiveSchema>) {
    return this.clients.archive(id, body.reason);
  }

  @Post(':id/restore')
  @HttpCode(200)
  @RequirePermissions('clients.archive')
  restore(@Param('id', UUID) id: string) {
    return this.clients.restore(id);
  }

  @Post(':id/addresses')
  @RequirePermissions('clients.write')
  @ApiZodBody(addressSchema)
  addAddress(@Param('id', UUID) id: string, @Body(zp(addressSchema)) body: z.infer<typeof addressSchema>) {
    return this.clients.addAddress(id, body);
  }

  @Patch(':id/addresses/:addressId')
  @RequirePermissions('clients.write')
  updateAddress(
    @Param('id', UUID) id: string,
    @Param('addressId', UUID) addressId: string,
    @Body(zp(addressSchema.partial())) body: Partial<z.infer<typeof addressSchema>>,
  ) {
    return this.clients.updateAddress(id, addressId, body);
  }

  @Delete(':id/addresses/:addressId')
  @HttpCode(204)
  @RequirePermissions('clients.write')
  removeAddress(@Param('id', UUID) id: string, @Param('addressId', UUID) addressId: string) {
    return this.clients.removeAddress(id, addressId);
  }

  @Post(':id/contacts')
  @RequirePermissions('clients.write')
  @ApiZodBody(clientContactSchema)
  addContact(@Param('id', UUID) id: string, @Body(zp(clientContactSchema)) body: z.infer<typeof clientContactSchema>) {
    return this.clients.addContact(id, body);
  }

  @Patch(':id/contacts/:contactId')
  @RequirePermissions('clients.write')
  updateContact(
    @Param('id', UUID) id: string,
    @Param('contactId', UUID) contactId: string,
    @Body(zp(clientContactSchema.partial())) body: Partial<z.infer<typeof clientContactSchema>>,
  ) {
    return this.clients.updateContact(id, contactId, body);
  }

  @Delete(':id/contacts/:contactId')
  @HttpCode(204)
  @RequirePermissions('clients.write')
  removeContact(@Param('id', UUID) id: string, @Param('contactId', UUID) contactId: string) {
    return this.clients.removeContact(id, contactId);
  }

  @Post(':id/notes')
  @RequirePermissions('clients.write')
  @ApiZodBody(clientNoteSchema)
  addNote(@Param('id', UUID) id: string, @Body(zp(clientNoteSchema)) body: z.infer<typeof clientNoteSchema>) {
    return this.clients.addNote(id, body);
  }

  @Patch(':id/notes/:noteId')
  @RequirePermissions('clients.write')
  pinNote(
    @Param('id', UUID) id: string,
    @Param('noteId', UUID) noteId: string,
    @Body(zp(z.object({ isPinned: z.boolean() }))) body: { isPinned: boolean },
  ) {
    return this.clients.setNotePinned(id, noteId, body.isPinned);
  }
}
