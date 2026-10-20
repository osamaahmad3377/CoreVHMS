import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { notePhraseSchema, notePhraseUpdateSchema } from '@vcms/shared';
import { z } from 'zod';
import { RequireAnyPermission, RequirePermissions } from '../../common/auth/decorators';
import { RequestContext } from '../../common/context/request-context';
import { ApiZodBody, zp } from '../../common/http/zod';
import { NotePhrasesService } from './note-phrases.service';

const UUID = new ParseUUIDPipe();

@ApiTags('clinical')
@Controller('note-phrases')
export class NotePhrasesController {
  constructor(private readonly phrases: NotePhrasesService) {}

  /** The buttons shown under the note fields; the settings page asks for the switched-off ones as well. */
  @Get()
  @RequireAnyPermission('clinical.read', 'settings.manage')
  list(@Query('all') all?: string) {
    const canManage = RequestContext.get()?.permissions.has('settings.manage');
    return this.phrases.list({ includeInactive: all === 'true' && !!canManage });
  }

  @Post()
  @RequirePermissions('settings.manage')
  @ApiZodBody(notePhraseSchema)
  create(@Body(zp(notePhraseSchema)) body: z.infer<typeof notePhraseSchema>) {
    return this.phrases.create(body);
  }

  @Post('restore-starter')
  @HttpCode(200)
  @RequirePermissions('settings.manage')
  restore() {
    return this.phrases.restoreStarter();
  }

  @Patch(':id')
  @RequirePermissions('settings.manage')
  update(@Param('id', UUID) id: string, @Body(zp(notePhraseUpdateSchema)) body: z.infer<typeof notePhraseUpdateSchema>) {
    return this.phrases.update(id, body);
  }

  @Delete(':id')
  @RequirePermissions('settings.manage')
  remove(@Param('id', UUID) id: string) {
    return this.phrases.remove(id);
  }
}
