import type { AndroidSymbol, SFSymbol } from 'expo-symbols';

import type { BeautyCategorySlug } from '@/data/types';

export const CATEGORY_ICON_SIZE = 20;

export const categoryIcons: Record<
  BeautyCategorySlug,
  { ios: SFSymbol; android: AndroidSymbol; web: AndroidSymbol }
> = {
  nails: { ios: 'hand.raised', android: 'front_hand', web: 'front_hand' },
  hair: { ios: 'comb', android: 'content_cut', web: 'content_cut' },
  lashes: { ios: 'eye', android: 'visibility', web: 'visibility' },
  brows: { ios: 'eyebrow', android: 'face_3', web: 'face_3' },
  makeup: { ios: 'paintbrush.pointed', android: 'brush', web: 'brush' },
  massage: { ios: 'hands.sparkles', android: 'massage', web: 'massage' },
  facial: { ios: 'face.smiling', android: 'spa', web: 'spa' },
  waxing: { ios: 'drop', android: 'water_drop', web: 'water_drop' },
  other: { ios: 'ellipsis.circle', android: 'more_horiz', web: 'more_horiz' },
};
