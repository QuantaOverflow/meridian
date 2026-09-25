import { forwardSourceAction } from '~/server/lib/sourceActions';

// 暂停这个源的自动抓取；源与已有文章保留，resume 恢复
export default defineEventHandler(event => forwardSourceAction(event, 'pause'));
