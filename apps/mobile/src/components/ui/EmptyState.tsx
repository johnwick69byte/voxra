import { View, StyleSheet } from "react-native";
import { AppText } from "./Text";
import { PrimaryButton } from "../PrimaryButton";
import { theme } from "../../theme/tokens";

export function EmptyState({
  title,
  subtitle,
  actionLabel,
  onAction,
}: {
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.wrap}>
      <AppText variant="title" style={{ textAlign: "center" }}>
        {title}
      </AppText>
      {subtitle ? (
        <AppText variant="subtitle" style={{ textAlign: "center", marginTop: 8 }}>
          {subtitle}
        </AppText>
      ) : null}
      {actionLabel && onAction ? (
        <PrimaryButton label={actionLabel} onPress={onAction} style={{ marginTop: 20 }} />
      ) : null}
    </View>
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <EmptyState
      title="Something went wrong"
      subtitle={message || "Please try again."}
      actionLabel={onRetry ? "Retry" : undefined}
      onAction={onRetry}
    />
  );
}

const styles = StyleSheet.create({
  wrap: {
    padding: theme.spacing.xl,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 48,
  },
});
