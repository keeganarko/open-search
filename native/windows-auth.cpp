// Build with the Windows SDK. Uses the desktop HWND-aware Windows Hello API.
#include <windows.h>
#include <userconsentverifierinterop.h>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Security.Credentials.UI.h>
#include <iostream>

int wmain(int argc, wchar_t** argv) {
  if (argc != 2) return 2;
  try {
    wchar_t* end = nullptr;
    const auto number = wcstoull(argv[1], &end, 10);
    const auto owner = reinterpret_cast<HWND>(number);
    if (!number || !end || *end || !IsWindow(owner)) return 2;
    winrt::init_apartment(winrt::apartment_type::multi_threaded);
    using namespace winrt::Windows::Security::Credentials::UI;
    using Result = winrt::Windows::Foundation::IAsyncOperation<UserConsentVerificationResult>;
    if (UserConsentVerifier::CheckAvailabilityAsync().get() != UserConsentVerifierAvailability::Available) return 3;
    const auto interop = winrt::get_activation_factory<UserConsentVerifier, IUserConsentVerifierInterop>();
    Result operation{nullptr};
    winrt::hstring reason{L"Verify your identity to reveal a saved password in Voyager"};
    winrt::check_hresult(interop->RequestVerificationForWindowAsync(owner,
      reinterpret_cast<HSTRING>(winrt::get_abi(reason)), winrt::guid_of<Result>(), winrt::put_abi(operation)));
    if (operation.get() != UserConsentVerificationResult::Verified) return 4;
    std::cout << "VERIFIED";
    return 0;
  } catch (...) { return 5; }
}
