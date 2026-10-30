import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet } from 'react-native';

import { Brand } from '@/constants/theme';
import { useFavorites } from '@/context/favorites-context';
import { useTheme } from '@/hooks/use-theme';

type FavoriteButtonProps = {
  providerId: string;
};

export function FavoriteButton({ providerId }: FavoriteButtonProps) {
  const theme = useTheme();
  const { isFavorite, toggleFavorite } = useFavorites();
  const favorited = isFavorite(providerId);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={favorited ? 'Remove from favorites' : 'Add to favorites'}
      hitSlop={8}
      onPress={() => toggleFavorite(providerId)}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: theme.background },
        pressed && styles.pressed,
      ]}>
      <SymbolView
        name={
          favorited
            ? { ios: 'heart.fill', android: 'favorite', web: 'favorite' }
            : { ios: 'heart', android: 'favorite_border', web: 'favorite_border' }
        }
        tintColor={favorited ? Brand.dustyRose : theme.text}
        size={22}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.7,
  },
});
