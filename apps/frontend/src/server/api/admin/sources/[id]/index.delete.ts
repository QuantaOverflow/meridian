import { forwardSourceDelete } from '~/server/lib/sourceActions';

// 源不存在（404）、有文章被简报引用（409，提示改用暂停）都由 backend 判定并透传
export default defineEventHandler(event => forwardSourceDelete(event));
