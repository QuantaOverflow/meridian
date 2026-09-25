import { forwardSourceAction } from '~/server/lib/sourceActions';

export default defineEventHandler(event => forwardSourceAction(event, 'init'));
