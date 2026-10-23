import { Controller, Get, NotFoundException, Query } from '@nestjs/common';
import { HelpService } from './help.service.js';

/**
 * Help is readable by anybody signed in; the global guard has already established that.
 *
 * Deliberately not gated by a capability per page. The pages describe what the platform does,
 * not anybody's data, and a colleague who cannot do something is better served by a page that
 * says who can than by a page that is not there.
 */
@Controller('help')
export class HelpController {
  constructor(private readonly help: HelpService) {}

  @Get()
  nav() {
    return this.help.nav();
  }

  @Get('search')
  search(@Query('q') q?: string, @Query('limit') limit?: string) {
    const n = Math.min(Math.max(Number(limit) || 10, 1), 25);
    return { query: q ?? '', hits: q?.trim() ? this.help.search(q, n) : [] };
  }

  /** Slugs contain a slash, so the page is addressed by query string rather than by path. */
  @Get('page')
  page(@Query('slug') slug?: string) {
    const page = slug ? this.help.page(slug) : null;
    if (!page) throw new NotFoundException('There is no help page with that address.');
    return page;
  }
}
