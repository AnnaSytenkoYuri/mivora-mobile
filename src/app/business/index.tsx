import { Redirect, router, Stack, useFocusEffect, type Href } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ContentFadeIn, SkeletonBlock } from '@/components/skeleton-block';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { cardElevationStyle, MaxContentWidth, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useNotifications } from '@/context/notifications-context';
import { getMyManagedServices, type ManagedService } from '@/data/repositories/provider-services';
import {
  isProviderReadyToPublish,
  publishMyProvider,
  unpublishMyProvider,
  type OwnedProviderProfile,
} from '@/data/repositories/provider-setup';
import {
  fetchMyWorkingHours,
  type WeekdayHoursDraft,
} from '@/data/repositories/provider-working-hours';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useMyProvider } from '@/hooks/use-my-provider';
import { useTheme } from '@/hooks/use-theme';
import {
  buildBusinessSetupChecklist,
  resolveBusinessOnboarding,
  type BusinessOnboarding,
  type BusinessSetupStep,
} from '@/lib/business-setup-checklist';

export default function ProviderDashboardScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { provider, loading, error, reload } = useMyProvider(user?.id);

  if (!user) {
    return <Redirect href="/sign-in" />;
  }

  return (
    <ThemedView style={styles.screen}>
      <Stack.Screen
        options={{
          headerShown: true,
          headerBackTitle: 'Back',
          title: 'My Business',
        }}
      />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: Math.max(insets.bottom, Spacing.three) + Spacing.four },
        ]}
        showsVerticalScrollIndicator={false}>
        {loading && !provider ? (
          <BusinessDashboardSkeleton />
        ) : error && !provider ? (
          <View style={styles.block}>
            <ThemedText themeColor="textSecondary">{error}</ThemedText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Retry loading business"
              onPress={() => {
                void reload();
              }}
              style={({ pressed }) => [
                styles.actionButton,
                { backgroundColor: theme.backgroundSelected },
                pressed && styles.pressed,
              ]}>
              <ThemedText type="smallBold" themeColor="onPrimary">
                Retry
              </ThemedText>
            </Pressable>
          </View>
        ) : provider ? (
          <ContentFadeIn>
            <DashboardContent provider={provider} />
          </ContentFadeIn>
        ) : (
          <View style={styles.block}>
            <ThemedText type="smallBold">No business profile yet</ThemedText>
            <ThemedText themeColor="textSecondary">
              Create a provider profile from Profile to manage your business here.
            </ThemedText>
          </View>
        )}
      </ScrollView>
    </ThemedView>
  );
}

function DashboardContent({ provider }: { provider: OwnedProviderProfile }) {
  const theme = useTheme();
  const isDark = useColorScheme() === 'dark';
  const { unreadCount } = useNotifications();
  const [profile, setProfile] = useState(provider);
  const [services, setServices] = useState<ManagedService[] | undefined>();
  const [hours, setHours] = useState<WeekdayHoursDraft[] | undefined>();
  const [setupReady, setSetupReady] = useState(false);
  const [setupError, setSetupError] = useState<string | undefined>();
  const [publishing, setPublishing] = useState(false);
  const [statusError, setStatusError] = useState<string | undefined>();

  useEffect(() => {
    setProfile(provider);
  }, [provider]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      void Promise.allSettled([getMyManagedServices(), fetchMyWorkingHours()]).then(
        ([servicesResult, hoursResult]) => {
          if (cancelled) {
            return;
          }

          const errors: string[] = [];
          if (servicesResult.status === 'fulfilled') {
            setServices(servicesResult.value);
          } else {
            errors.push(
              servicesResult.reason instanceof Error
                ? servicesResult.reason.message
                : 'Could not load services.',
            );
          }

          if (hoursResult.status === 'fulfilled') {
            setHours(hoursResult.value);
          } else {
            errors.push(
              hoursResult.reason instanceof Error
                ? hoursResult.reason.message
                : 'Could not load working hours.',
            );
          }

          setSetupError(errors.length > 0 ? errors.join(' ') : undefined);
          setSetupReady(true);
        },
      );

      return () => {
        cancelled = true;
      };
    }, [provider.id]),
  );

  const kindLabel = profile.kind === 'salon' ? 'Salon' : 'Specialist';
  const checklist = setupReady
    ? buildBusinessSetupChecklist({ provider: profile, services, hours })
    : [];
  const doneCount = checklist.filter((item) => item.done).length;
  const setupComplete = setupReady && checklist.length > 0 && checklist.every((item) => item.done);
  const canPublish = setupReady && isProviderReadyToPublish(profile, hours) && !publishing;
  const onboarding = setupReady
    ? resolveBusinessOnboarding(
        checklist,
        {
          services: services !== undefined,
          hours: hours !== undefined,
        },
        profile,
      )
    : undefined;
  const showChecklistPublish = !profile.published && onboarding?.stepId !== 'publish';

  async function onPublish() {
    if (!canPublish || profile.published) {
      return;
    }

    setPublishing(true);
    setStatusError(undefined);
    const result = await publishMyProvider();
    setPublishing(false);

    if (!result.ok) {
      setStatusError(result.message);
      return;
    }

    setProfile(result.provider);
  }

  function confirmUnpublish() {
    if (publishing || !profile.published) {
      return;
    }

    Alert.alert(
      'Unpublish this profile?',
      'Customers will no longer find you in Search or Featured. Existing bookings stay in their history.',
      [
        { text: 'Keep published', style: 'cancel' },
        {
          text: 'Unpublish',
          style: 'destructive',
          onPress: () => {
            void onUnpublish();
          },
        },
      ],
    );
  }

  async function onUnpublish() {
    setPublishing(true);
    setStatusError(undefined);
    const result = await unpublishMyProvider();
    setPublishing(false);

    if (!result.ok) {
      setStatusError(result.message);
      return;
    }

    setProfile(result.provider);
  }

  return (
    <View style={styles.dashboard}>
      <ThemedView type="backgroundElement" style={[styles.card, cardElevationStyle(isDark)]}>
        <ThemedText style={styles.heading}>{profile.name}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {kindLabel} · {profile.area}, {profile.city}
        </ThemedText>
        <PublicationStatusChip published={profile.published} />
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={3}>
          {profile.bio || 'No bio yet.'}
        </ThemedText>
      </ThemedView>

      <View style={styles.block}>
        <ThemedText style={styles.sectionTitle}>Overview</ThemedText>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Customer bookings"
          onPress={() => router.push('/business/bookings' as Href)}
          style={({ pressed }) => [
            styles.navRow,
            { backgroundColor: theme.backgroundElement },
            cardElevationStyle(isDark),
            pressed && styles.pressed,
          ]}>
          <ThemedText type="smallBold">Customer bookings</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Incoming appointments
          </ThemedText>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            unreadCount > 0
              ? `Notifications, ${unreadCount > 99 ? '99+' : unreadCount} unread`
              : 'Notifications'
          }
          onPress={() => router.push('/notifications' as Href)}
          style={({ pressed }) => [
            styles.notificationsRow,
            { backgroundColor: theme.backgroundElement },
            cardElevationStyle(isDark),
            pressed && styles.pressed,
          ]}>
          <SymbolView
            name={{ ios: 'bell', android: 'notifications', web: 'notifications' }}
            size={22}
            tintColor={theme.text}
          />
          <View style={styles.notificationsCopy}>
            <ThemedText type="smallBold">Notifications</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Booking updates
            </ThemedText>
          </View>
          {unreadCount > 0 ? (
            <View style={[styles.unreadBadge, { backgroundColor: theme.text }]}>
              <ThemedText type="smallBold" style={[styles.unreadBadgeText, { color: theme.background }]}>
                {unreadCount > 99 ? '99+' : String(unreadCount)}
              </ThemedText>
            </View>
          ) : null}
        </Pressable>
      </View>

      {onboarding ? (
        <ContentFadeIn>
          <OnboardingCard
            onboarding={onboarding}
            publishing={publishing}
            canPublish={canPublish}
            onPublish={() => {
              void onPublish();
            }}
          />
        </ContentFadeIn>
      ) : null}

      <ThemedView type="backgroundElement" style={[styles.card, cardElevationStyle(isDark)]}>
        {setupReady ? (
          setupComplete ? (
            <ContentFadeIn style={styles.block}>
              <ThemedText type="smallBold">
                Setup complete · {doneCount}/{checklist.length}
              </ThemedText>
              {statusError ? (
                <ThemedText type="small" themeColor="textSecondary">
                  {statusError}
                </ThemedText>
              ) : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Unpublish"
                disabled={publishing}
                onPress={confirmUnpublish}
                style={({ pressed }) => [
                  styles.actionButton,
                  { backgroundColor: theme.background },
                  publishing && styles.disabled,
                  pressed && !publishing && styles.pressed,
                ]}>
                {publishing ? (
                  <View style={styles.buttonStatus}>
                    <ActivityIndicator />
                    <ThemedText type="smallBold">Updating…</ThemedText>
                  </View>
                ) : (
                  <ThemedText type="smallBold">Unpublish</ThemedText>
                )}
              </Pressable>
            </ContentFadeIn>
          ) : (
            <ContentFadeIn style={styles.block}>
              <ThemedText type="smallBold">Setup checklist</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {`${doneCount} of ${checklist.length} complete. Portfolio is optional. Your profile stays hidden from Search and Home until it is published.`}
              </ThemedText>
              {setupError ? (
                <ThemedText type="small" themeColor="textSecondary">
                  {setupError} Services and hours are marked incomplete until they can be verified.
                </ThemedText>
              ) : null}
              {checklist.map((item) => (
                <ChecklistRow key={item.id} step={item} />
              ))}
              {statusError ? (
                <ThemedText type="small" themeColor="textSecondary">
                  {statusError}
                </ThemedText>
              ) : null}
              {profile.published ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Unpublish"
                  disabled={publishing}
                  onPress={confirmUnpublish}
                  style={({ pressed }) => [
                    styles.actionButton,
                    { backgroundColor: theme.background },
                    publishing && styles.disabled,
                    pressed && !publishing && styles.pressed,
                  ]}>
                  {publishing ? (
                    <View style={styles.buttonStatus}>
                      <ActivityIndicator />
                      <ThemedText type="smallBold">Updating…</ThemedText>
                    </View>
                  ) : (
                    <ThemedText type="smallBold">Unpublish</ThemedText>
                  )}
                </Pressable>
              ) : showChecklistPublish ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Publish"
                  disabled={!canPublish}
                  onPress={() => {
                    void onPublish();
                  }}
                  style={({ pressed }) => [
                    styles.actionButton,
                    { backgroundColor: theme.backgroundSelected },
                    !canPublish && styles.disabled,
                    pressed && canPublish && styles.pressed,
                  ]}>
                  {publishing ? (
                    <View style={styles.buttonStatus}>
                      <ActivityIndicator color={theme.onPrimary} />
                      <ThemedText type="smallBold" themeColor="onPrimary">
                        Publishing…
                      </ThemedText>
                    </View>
                  ) : (
                    <ThemedText type="smallBold" themeColor="onPrimary">
                      Publish
                    </ThemedText>
                  )}
                </Pressable>
              ) : null}
            </ContentFadeIn>
          )
        ) : (
          <ChecklistSkeleton />
        )}
      </ThemedView>

      <View style={styles.block}>
        <ThemedText style={styles.sectionTitle}>Manage business</ThemedText>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Edit business profile"
          onPress={() => router.push('/business/edit')}
          style={({ pressed }) => [
            styles.navRow,
            { backgroundColor: theme.backgroundElement },
            cardElevationStyle(isDark),
            pressed && styles.pressed,
          ]}>
          <ThemedText type="smallBold">Edit business profile</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Name, type, location, and bio
          </ThemedText>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Manage services"
          onPress={() => router.push('/business/services')}
          style={({ pressed }) => [
            styles.navRow,
            { backgroundColor: theme.backgroundElement },
            cardElevationStyle(isDark),
            pressed && styles.pressed,
          ]}>
          <ThemedText type="smallBold">Manage services</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {profile.serviceCount === 1 ? '1 service' : `${profile.serviceCount} services`}
          </ThemedText>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Portfolio"
          onPress={() => router.push('/business/portfolio')}
          style={({ pressed }) => [
            styles.navRow,
            { backgroundColor: theme.backgroundElement },
            cardElevationStyle(isDark),
            pressed && styles.pressed,
          ]}>
          <ThemedText type="smallBold">Portfolio</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Photos of your work
          </ThemedText>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Working hours"
          onPress={() => router.push('/business/hours' as Href)}
          style={({ pressed }) => [
            styles.navRow,
            { backgroundColor: theme.backgroundElement },
            cardElevationStyle(isDark),
            pressed && styles.pressed,
          ]}>
          <ThemedText type="smallBold">Working hours</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Weekly schedule in Bangkok time
          </ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

function PublicationStatusChip({ published }: { published: boolean }) {
  const theme = useTheme();

  return (
    <View
      style={[
        styles.statusChip,
        {
          backgroundColor: theme.backgroundElement,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: published ? theme.accent : theme.border,
        },
      ]}>
      <ThemedText type="small" themeColor={published ? undefined : 'textSecondary'}>
        {published ? 'Published' : 'Draft'}
      </ThemedText>
    </View>
  );
}

function OnboardingCard({
  onboarding,
  publishing,
  canPublish,
  onPublish,
}: {
  onboarding: BusinessOnboarding;
  publishing: boolean;
  canPublish: boolean;
  onPublish: () => void;
}) {
  const theme = useTheme();
  const isPublishAction = onboarding.stepId === 'publish';
  const disabled = isPublishAction && (!canPublish || publishing);

  function onPress() {
    if (isPublishAction) {
      if (!disabled) {
        onPublish();
      }
      return;
    }

    if (onboarding.href) {
      router.push(onboarding.href);
    }
  }

  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <ThemedText type="smallBold">{onboarding.title}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {onboarding.message}
      </ThemedText>
      {onboarding.actionLabel ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={onboarding.actionLabel}
          disabled={disabled}
          onPress={onPress}
          style={({ pressed }) => [
            styles.actionButton,
            { backgroundColor: theme.backgroundSelected },
            disabled && styles.disabled,
            pressed && !disabled && styles.pressed,
          ]}>
          {isPublishAction && publishing ? (
            <View style={styles.buttonStatus}>
              <ActivityIndicator color={theme.onPrimary} />
              <ThemedText type="smallBold" themeColor="onPrimary">
                Publishing…
              </ThemedText>
            </View>
          ) : (
            <ThemedText type="smallBold" themeColor="onPrimary">
              {onboarding.actionLabel}
            </ThemedText>
          )}
        </Pressable>
      ) : null}
    </ThemedView>
  );
}

function BusinessDashboardSkeleton() {
  return (
    <View accessibilityLabel="Loading business dashboard" style={styles.skeleton}>
      <SkeletonBlock style={styles.skeletonHeading} />
      <SkeletonBlock style={styles.skeletonLineShort} />
      <SkeletonBlock style={styles.skeletonChip} />
      <SkeletonBlock style={styles.skeletonBody} />
      <SkeletonBlock style={styles.skeletonSectionTitle} />
      {['a', 'b'].map((key) => (
        <ThemedView key={key} type="backgroundElement" style={styles.navRow}>
          <SkeletonBlock style={styles.skeletonLine} />
          <SkeletonBlock style={styles.skeletonLineShort} />
        </ThemedView>
      ))}
      <ThemedView type="backgroundElement" style={styles.card}>
        <ChecklistSkeleton />
      </ThemedView>
      <SkeletonBlock style={styles.skeletonSectionTitle} />
      {['c', 'd', 'e', 'f'].map((key) => (
        <ThemedView key={key} type="backgroundElement" style={styles.navRow}>
          <SkeletonBlock style={styles.skeletonLine} />
          <SkeletonBlock style={styles.skeletonLineShort} />
        </ThemedView>
      ))}
    </View>
  );
}

function ChecklistSkeleton() {
  return (
    <View accessibilityLabel="Loading setup checklist" style={styles.block}>
      <SkeletonBlock style={styles.skeletonBody} />
      {['a', 'b', 'c', 'd'].map((key) => (
        <View key={key} style={styles.checklistRow}>
          <SkeletonBlock style={styles.skeletonMark} />
          <SkeletonBlock style={styles.skeletonLine} />
        </View>
      ))}
      <SkeletonBlock style={styles.skeletonButton} />
    </View>
  );
}

function ChecklistRow({ step }: { step: BusinessSetupStep }) {
  const body = (
    <View style={styles.checklistRow}>
      <ThemedText type="smallBold">{step.done ? '✓' : '○'}</ThemedText>
      <View style={styles.checklistCopy}>
        <ThemedText type={step.done ? 'small' : 'smallBold'}>{step.label}</ThemedText>
      </View>
    </View>
  );

  if (!step.href) {
    return body;
  }

  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={step.label}
      onPress={() => router.push(step.href as Href)}
      style={({ pressed }) => pressed && styles.pressed}>
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
    gap: Spacing.four,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  heading: {
    fontSize: 24,
    lineHeight: 30,
    fontWeight: 600,
  },
  sectionTitle: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: 600,
  },
  dashboard: {
    gap: Spacing.four,
  },
  block: {
    gap: Spacing.two,
  },
  skeleton: {
    gap: Spacing.two,
  },
  card: {
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Spacing.three,
  },
  statusChip: {
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    borderRadius: Spacing.two,
  },
  checklistRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
    minHeight: 44,
  },
  checklistCopy: {
    flex: 1,
    gap: Spacing.half,
  },
  navRow: {
    minHeight: 44,
    justifyContent: 'center',
    gap: Spacing.half,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
  },
  notificationsRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
  },
  notificationsCopy: {
    flex: 1,
    gap: Spacing.half,
  },
  unreadBadge: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: Spacing.one,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadBadgeText: {
    fontSize: 12,
    lineHeight: 16,
  },
  actionButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    borderRadius: Spacing.three,
  },
  buttonStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  disabled: {
    opacity: 0.4,
  },
  pressed: {
    opacity: 0.7,
  },
  skeletonHeading: {
    height: 24,
    width: '58%',
    borderRadius: Spacing.two,
  },
  skeletonSectionTitle: {
    height: 20,
    width: '40%',
    marginTop: Spacing.two,
  },
  skeletonChip: {
    height: 22,
    width: 88,
    borderRadius: Spacing.two,
  },
  skeletonLine: {
    height: 14,
    width: '84%',
  },
  skeletonLineShort: {
    height: 14,
    width: '42%',
  },
  skeletonBody: {
    height: 12,
    width: '92%',
  },
  skeletonMark: {
    width: 14,
    height: 14,
  },
  skeletonButton: {
    height: 44,
    width: '100%',
    borderRadius: Spacing.three,
    marginTop: Spacing.one,
  },
});
